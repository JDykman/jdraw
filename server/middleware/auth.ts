import { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'

export interface AuthUser {
	id: string
	username: string
	isAdmin: boolean
}

declare global {
	namespace Express {
		interface Request {
			user?: AuthUser
		}
	}
}

function getAccessSecret() {
	return process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret-change-in-production'
}

export function getRefreshSecret() {
	return process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret-change-in-production'
}

export function signAccessToken(user: AuthUser): string {
	return jwt.sign(user, getAccessSecret(), { expiresIn: '15m' })
}

export function signRefreshToken(user: AuthUser): string {
	return jwt.sign(user, getRefreshSecret(), { expiresIn: '7d' })
}

function extractUser(payload: unknown): AuthUser {
	const p = payload as AuthUser
	return { id: p.id, username: p.username, isAdmin: p.isAdmin }
}

export function verifyAccessToken(token: string): AuthUser | null {
	try {
		return extractUser(jwt.verify(token, getAccessSecret()))
	} catch {
		return null
	}
}

export function verifyRefreshToken(token: string): AuthUser | null {
	try {
		return extractUser(jwt.verify(token, getRefreshSecret()))
	} catch {
		return null
	}
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
	const header = req.headers.authorization
	if (!header?.startsWith('Bearer ')) {
		res.status(401).json({ error: 'Unauthorized' })
		return
	}
	const user = verifyAccessToken(header.slice(7))
	if (!user) {
		res.status(401).json({ error: 'Invalid or expired token' })
		return
	}
	req.user = user
	next()
}

export function adminOnly(req: Request, res: Response, next: NextFunction) {
	if (!req.user?.isAdmin) {
		res.status(403).json({ error: 'Forbidden' })
		return
	}
	next()
}
