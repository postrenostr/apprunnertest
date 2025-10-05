import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import type { Express, NextFunction, Request, Response } from "express";
import { pool } from "./db";
import { storage } from "./storage";
import type { AuthenticatedUser } from "@shared/schema";

const PgSession = connectPgSimple(session);

export function configureAuth(app: Express) {
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    throw new Error("SESSION_SECRET is not configured");
  }

  app.use(
    session({
      store: new PgSession({
        pool,
        tableName: "sessions"
      }),
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000
      }
    })
  );

  const clientID = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientID || !clientSecret) {
    throw new Error("Google OAuth is not configured");
  }

  passport.use(
    new GoogleStrategy(
      {
        clientID,
        clientSecret,
        callbackURL: "/auth/google/callback",
        scope: ["profile", "email"]
      },
      async (_accessToken, _refreshToken, profile, done) => {
        const user: AuthenticatedUser = {
          claims: {
            sub: profile.id,
            email: profile.emails?.[0]?.value ?? "",
            first_name: profile.name?.givenName ?? "",
            last_name: profile.name?.familyName ?? "",
            profile_image_url: profile.photos?.[0]?.value ?? ""
          },
          access_token: _accessToken,
          refresh_token: _refreshToken ?? undefined,
          expires_at: Date.now() + 60 * 60 * 1000
        };

        await storage.upsertUser({
          id: user.claims.sub,
          email: user.claims.email,
          firstName: user.claims.first_name,
          lastName: user.claims.last_name,
          profileImageUrl: user.claims.profile_image_url,
          subscriptionStatus: "inactive"
        });

        done(null, user);
      }
    )
  );

  passport.serializeUser((user, done) => {
    done(null, user as AuthenticatedUser);
  });

  passport.deserializeUser((obj: AuthenticatedUser, done) => {
    done(null, obj);
  });

  app.use(passport.initialize());
  app.use(passport.session());
}

export const googleAuthHandler = passport.authenticate("google", {
  scope: ["profile", "email"],
  prompt: "select_account"
});

export const googleAuthCallbackHandler = passport.authenticate("google", {
  failureRedirect: "/"
});

export function ensureAuthenticated(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: "Unauthorized" });
}
