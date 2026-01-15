/**
 * OAuth Routes for Social Authentication
 * Handles Google, Facebook, LinkedIn, Instagram login flows
 */

import passport from 'passport';
import type { Request, Response } from 'express';
import { createTokenPair } from 'core-service';
import type { User } from './types.js';

/**
 * Setup OAuth routes
 */
export function setupOAuthRoutes(app: any) {
  // ═══════════════════════════════════════════════════════════════════
  // Google OAuth
  // ═══════════════════════════════════════════════════════════════════
  
  app.get('/auth/google', (req: Request, res: Response, next: any) => {
    const tenantId = req.query.tenantId || 'default-tenant';
    passport.authenticate('google', {
      scope: ['profile', 'email'],
      state: tenantId as string,
    })(req, res, next);
  });

  app.get('/auth/google/callback',
    passport.authenticate('google', { session: false, failureRedirect: '/login?error=google' }),
    async (req: Request, res: Response) => {
      try {
        const user = req.user as User;
        const tokens = createTokenPair({
          userId: user.id,
          tenantId: user.tenantId,
          roles: user.roles,
          permissions: user.permissions,
        }, {
          secret: process.env.JWT_SECRET || process.env.SHARED_JWT_SECRET || 'shared-jwt-secret-change-in-production',
          expiresIn: '1h',
          refreshExpiresIn: '7d',
        });

        // Redirect to frontend with tokens
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        const redirectUrl = `${frontendUrl}/auth/callback?` +
          `accessToken=${tokens.accessToken}&` +
          `refreshToken=${tokens.refreshToken}&` +
          `userId=${user.id}`;
        
        res.redirect(redirectUrl);
      } catch (error) {
        res.redirect('/login?error=auth_failed');
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // Facebook OAuth
  // ═══════════════════════════════════════════════════════════════════
  
  app.get('/auth/facebook', (req: Request, res: Response, next: any) => {
    const tenantId = req.query.tenantId || 'default-tenant';
    passport.authenticate('facebook', {
      scope: ['email'],
      state: tenantId as string,
    })(req, res, next);
  });

  app.get('/auth/facebook/callback',
    passport.authenticate('facebook', { session: false, failureRedirect: '/login?error=facebook' }),
    async (req: Request, res: Response) => {
      try {
        const user = req.user as User;
        const tokens = createTokenPair({
          userId: user.id,
          tenantId: user.tenantId,
          roles: user.roles,
          permissions: user.permissions,
        }, {
          secret: process.env.JWT_SECRET || process.env.SHARED_JWT_SECRET || 'shared-jwt-secret-change-in-production',
          expiresIn: '1h',
          refreshExpiresIn: '7d',
        });

        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        const redirectUrl = `${frontendUrl}/auth/callback?` +
          `accessToken=${tokens.accessToken}&` +
          `refreshToken=${tokens.refreshToken}&` +
          `userId=${user.id}`;
        
        res.redirect(redirectUrl);
      } catch (error) {
        res.redirect('/login?error=auth_failed');
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // LinkedIn OAuth
  // ═══════════════════════════════════════════════════════════════════
  
  app.get('/auth/linkedin', (req: Request, res: Response, next: any) => {
    const tenantId = req.query.tenantId || 'default-tenant';
    passport.authenticate('linkedin', {
      scope: ['r_emailaddress', 'r_liteprofile'],
      state: tenantId as string,
    })(req, res, next);
  });

  app.get('/auth/linkedin/callback',
    passport.authenticate('linkedin', { session: false, failureRedirect: '/login?error=linkedin' }),
    async (req: Request, res: Response) => {
      try {
        const user = req.user as User;
        const tokens = createTokenPair({
          userId: user.id,
          tenantId: user.tenantId,
          roles: user.roles,
          permissions: user.permissions,
        }, {
          secret: process.env.JWT_SECRET || process.env.SHARED_JWT_SECRET || 'shared-jwt-secret-change-in-production',
          expiresIn: '1h',
          refreshExpiresIn: '7d',
        });

        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        const redirectUrl = `${frontendUrl}/auth/callback?` +
          `accessToken=${tokens.accessToken}&` +
          `refreshToken=${tokens.refreshToken}&` +
          `userId=${user.id}`;
        
        res.redirect(redirectUrl);
      } catch (error) {
        res.redirect('/login?error=auth_failed');
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // Instagram OAuth (via Facebook)
  // ═══════════════════════════════════════════════════════════════════
  
  app.get('/auth/instagram', (req: Request, res: Response, next: any) => {
    const tenantId = req.query.tenantId || 'default-tenant';
    // Instagram uses Facebook's OAuth with specific scope
    passport.authenticate('facebook', {
      scope: ['instagram_basic', 'instagram_manage_messages'],
      state: tenantId as string,
    })(req, res, next);
  });
}
