import { createHmac, timingSafeEqual } from "node:crypto";
import type { WorkspaceId } from "@frc-coderunner/contracts";

/**
 * Preview iframes are sandboxed without `allow-same-origin`, so their document
 * has an opaque origin. Browsers compute a null site-for-cookies for such a
 * document, which means the `SameSite=Lax` session cookie is dropped from every
 * subresource request and in-frame navigation the framed report makes — the
 * document itself loads (that navigation is parent-initiated) but its CSS, JS,
 * images and page links would all come back unauthenticated.
 *
 * So the grant travels in the URL path instead of in a cookie. A report's links
 * are relative, so the browser rebuilds every follow-up URL from the current
 * one and the token segment is inherited for free — the report never has to
 * know it exists.
 *
 * The token authorises reading one workspace's project tree, expires quickly,
 * and is only ever handed to the owner of that workspace. Responses that carry
 * it set `Referrer-Policy: no-referrer` and `Cache-Control: no-store` so it does
 * not leak outward or linger in a shared cache.
 */

/** Signed payload version. Bump if the payload shape changes. */
const TOKEN_VERSION = "p1";

/**
 * Long enough for a report and its assets to load, while limiting the window
 * in which an exposed URL remains useful. Every document-list fetch — first
 * activation, project swap, Refresh — mints a fresh one.
 */
export const PREVIEW_TOKEN_TTL_SECONDS = 15 * 60;

/**
 * Domain separation: this label is part of the signed message so a preview
 * token can never be mistaken for, or forged from, any other HMAC the control
 * plane derives from the same session secret.
 */
const SIGNING_LABEL = "coderunner.preview.v1";

function sign(secret: string, workspaceId: string, expiresAt: number): string {
	return createHmac("sha256", secret)
		.update(`${SIGNING_LABEL}.${workspaceId}.${expiresAt}`)
		.digest("base64url");
}

/** Mint a token authorising reads of `workspaceId`'s project tree. */
export function mintPreviewToken(
	secret: string,
	workspaceId: WorkspaceId,
	nowSeconds: number = Math.floor(Date.now() / 1000),
): { token: string; expiresIn: number } {
	const expiresAt = nowSeconds + PREVIEW_TOKEN_TTL_SECONDS;
	const signature = sign(secret, workspaceId, expiresAt);
	return {
		token: `${TOKEN_VERSION}.${expiresAt}.${signature}`,
		expiresIn: PREVIEW_TOKEN_TTL_SECONDS,
	};
}

/**
 * Whether `token` is a live grant for `workspaceId`. Because the workspace id
 * is part of the signed message, a token minted for one student does not verify
 * against another student's workspace even if it is pasted into their URL.
 */
export function verifyPreviewToken(
	secret: string,
	workspaceId: WorkspaceId,
	token: string,
	nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
	const parts = token.split(".");
	if (parts.length !== 3) return false;
	const [version, expiresAtRaw, signature] = parts as [string, string, string];
	if (version !== TOKEN_VERSION) return false;
	if (!/^\d{1,15}$/.test(expiresAtRaw)) return false;

	const expiresAt = Number(expiresAtRaw);
	if (expiresAt <= nowSeconds) return false;

	const expected = sign(secret, workspaceId, expiresAt);
	// Compare over the *expected* signature's byte length so a truncated or
	// padded candidate fails on length rather than throwing out of
	// timingSafeEqual.
	const expectedBytes = Buffer.from(expected, "utf8");
	const candidateBytes = Buffer.from(signature, "utf8");
	if (expectedBytes.length !== candidateBytes.length) return false;
	return timingSafeEqual(expectedBytes, candidateBytes);
}
