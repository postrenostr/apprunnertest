import type { Express, Request } from "express";
import express from "express";
import Stripe from "stripe";
import { ensureAuthenticated } from "./auth";
import { storage } from "./storage";
import { authorizeObjectRequest, normalizeObjectPath, setObjectAcl } from "./objectAcl";
import { bucket, createSignedUploadUrl } from "./objectStorage";
import type { AuthenticatedUser } from "@shared/schema";
import { z } from "zod";

const postcardInputSchema = z.object({
  imageUrl: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  isPublic: z.enum(["true", "false"])
});

const postcardOrderInputSchema = z.object({
  postcardId: z.string().min(1)
});

const uploadRequestSchema = z.object({
  contentType: z.string().min(1),
  isPublic: z.boolean()
});

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

if (!stripeSecretKey) {
  throw new Error("STRIPE_SECRET_KEY is not configured");
}

const stripe = new Stripe(stripeSecretKey, {
  apiVersion: "2023-10-16"
});

function getAuthedUser(req: Request): AuthenticatedUser | undefined {
  return req.user as AuthenticatedUser | undefined;
}

export function registerRoutes(app: Express) {
  const router = express.Router();

  router.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  router.get("/login", (req, res) => {
    res.redirect("/api/auth/google");
  });

  router.get("/logout", (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      req.session?.destroy(() => {
        res.clearCookie("connect.sid");
        res.redirect("/");
      });
    });
  });

  router.get("/auth/user", ensureAuthenticated, async (req, res) => {
    const user = getAuthedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const profile = await storage.getUser(user.claims.sub);
    res.json({ user: profile });
  });

  router.post("/create-subscription", ensureAuthenticated, async (req, res, next) => {
    try {
      const user = getAuthedUser(req);
      if (!user) return res.status(401).json({ error: "Unauthorized" });

      const dbUser = await storage.getUser(user.claims.sub);
      if (!dbUser) return res.status(404).json({ error: "User not found" });

      let customerId = dbUser.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.claims.email,
          name: `${user.claims.first_name} ${user.claims.last_name}`.trim()
        });
        customerId = customer.id;
      }

      const product = await stripe.products.create({ name: "Premium Plan" });
      const price = await stripe.prices.create({
        currency: "usd",
        unit_amount: 100,
        recurring: { interval: "month" },
        product: product.id
      });

      const subscription = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: price.id }],
        payment_behavior: "default_incomplete",
        payment_settings: { save_default_payment_method: "on_subscription" },
        expand: ["latest_invoice.payment_intent"]
      });

      const paymentIntent = subscription.latest_invoice
        ?.payment_intent as Stripe.PaymentIntent;

      if (!paymentIntent?.client_secret) {
        throw new Error("Failed to retrieve payment intent client secret");
      }

      await storage.updateUserStripeInfo(user.claims.sub, customerId, subscription.id);

      res.json({
        subscriptionId: subscription.id,
        clientSecret: paymentIntent.client_secret
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/subscription-status", ensureAuthenticated, async (req, res, next) => {
    try {
      const user = getAuthedUser(req);
      if (!user) return res.status(401).json({ error: "Unauthorized" });

      const dbUser = await storage.getUser(user.claims.sub);
      if (!dbUser?.stripeSubscriptionId) {
        return res.json({ status: "inactive" });
      }

      const subscription = await stripe.subscriptions.retrieve(dbUser.stripeSubscriptionId);
      await storage.updateSubscriptionStatus(
        user.claims.sub,
        subscription.status,
        subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : null
      );
      res.json({
        status: subscription.status,
        currentPeriodEnd: subscription.current_period_end,
        nextBillingDate: subscription.billing_cycle_anchor
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/create-portal-session", ensureAuthenticated, async (req, res, next) => {
    try {
      const user = getAuthedUser(req);
      if (!user) return res.status(401).json({ error: "Unauthorized" });

      const dbUser = await storage.getUser(user.claims.sub);
      if (!dbUser?.stripeCustomerId) {
        return res.status(400).json({ error: "No Stripe customer" });
      }

      const session = await stripe.billingPortal.sessions.create({
        customer: dbUser.stripeCustomerId,
        return_url: `${req.protocol}://${req.get("host")}`
      });
      res.json({ url: session.url });
    } catch (error) {
      next(error);
    }
  });

  router.post("/objects/upload", ensureAuthenticated, async (req, res, next) => {
    try {
      const user = getAuthedUser(req);
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      const dbUser = await storage.getUser(user.claims.sub);
      if (!dbUser || dbUser.subscriptionStatus !== "active") {
        return res.status(403).json({ error: "Subscription required" });
      }

      const { contentType, isPublic } = uploadRequestSchema.parse(req.body);
      const signed = await createSignedUploadUrl({ contentType, isPublic }, user.claims.sub);
      res.json(signed);
    } catch (error) {
      next(error);
    }
  });

  router.get("/postcards", ensureAuthenticated, async (req, res, next) => {
    try {
      const user = getAuthedUser(req);
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      const dbUser = await storage.getUser(user.claims.sub);
      if (!dbUser || dbUser.subscriptionStatus !== "active") {
        return res.status(403).json({ error: "Subscription required" });
      }
      const records = await storage.getUserPostcards(user.claims.sub);
      res.json(records);
    } catch (error) {
      next(error);
    }
  });

  router.post("/postcards", ensureAuthenticated, async (req, res, next) => {
    try {
      const user = getAuthedUser(req);
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      const dbUser = await storage.getUser(user.claims.sub);
      if (!dbUser || dbUser.subscriptionStatus !== "active") {
        return res.status(403).json({ error: "Subscription required" });
      }
      const parsed = postcardInputSchema.parse(req.body);
      const { imageUrl, title, description, isPublic } = parsed;
      const normalizedPath = normalizeObjectPath(imageUrl);
      const postcard = await storage.createPostcard({
        userId: user.claims.sub,
        imageUrl: normalizedPath,
        title,
        description,
        isPublic
      });

      await setObjectAcl({
        path: normalizedPath,
        isPublic: isPublic === "true",
        ownerId: user.claims.sub
      });

      res.status(201).json(postcard);
    } catch (error) {
      next(error);
    }
  });

  router.get("/postcard-orders", ensureAuthenticated, async (req, res, next) => {
    try {
      const user = getAuthedUser(req);
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      const dbUser = await storage.getUser(user.claims.sub);
      if (!dbUser || dbUser.subscriptionStatus !== "active") {
        return res.status(403).json({ error: "Subscription required" });
      }
      const orders = await storage.getUserPostcardOrders(user.claims.sub);
      res.json(orders);
    } catch (error) {
      next(error);
    }
  });

  router.post("/postcard-orders", ensureAuthenticated, async (req, res, next) => {
    try {
      const user = getAuthedUser(req);
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      const dbUser = await storage.getUser(user.claims.sub);
      if (!dbUser || dbUser.subscriptionStatus !== "active") {
        return res.status(403).json({ error: "Subscription required" });
      }
      const { postcardId } = postcardOrderInputSchema.parse(req.body);

      const paymentIntent = await stripe.paymentIntents.create({
        amount: 1000,
        currency: "usd",
        metadata: {
          type: "postcard_order",
          userId: user.claims.sub,
          postcardId
        }
      });

      const order = await storage.createPostcardOrder({
        userId: user.claims.sub,
        postcardId,
        quantity: "20",
        totalAmount: "1000",
        stripePaymentIntentId: paymentIntent.id,
        orderStatus: "pending"
      });

      if (!paymentIntent.client_secret) {
        throw new Error("Stripe did not return a client secret");
      }

      res.status(201).json({ orderId: order.id, clientSecret: paymentIntent.client_secret });
    } catch (error) {
      next(error);
    }
  });

  router.post("/postcard-orders/:id/confirm", ensureAuthenticated, async (req, res, next) => {
    try {
      const user = getAuthedUser(req);
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      const orderId = req.params.id;
      const order = await storage.getPostcardOrder(orderId);
      if (!order || order.userId !== user.claims.sub) {
        return res.status(404).json({ error: "Order not found" });
      }

      await storage.updatePostcardOrderStatus(orderId, "paid");
      res.json({ status: "paid" });
    } catch (error) {
      next(error);
    }
  });

  app.use("/api", express.json(), router);

  app.get("/objects/:objectPath(*)", async (req, res, next) => {
    try {
      if (!bucket) throw new Error("Object storage not configured");
      const normalized = normalizeObjectPath(req.params.objectPath);
      const authorized = await authorizeObjectRequest(req, normalized);
      if (!authorized) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const file = bucket.file(normalized.replace(/^\/objects\//, ""));
      const [metadata] = await file.getMetadata();
      res.setHeader("Content-Type", metadata.contentType ?? "application/octet-stream");
      file
        .createReadStream()
        .on("error", next)
        .pipe(res);
    } catch (error) {
      next(error);
    }
  });
}
