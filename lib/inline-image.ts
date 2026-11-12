/** A link to a screenshot pasted into the app (served by /api/files after a sign-in check). */
export const isInlineImage = (src: string) => /^\/api\/files\/inline-files\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.[a-z0-9]{1,5}$/i.test(src);

/** The /api/files link for an image path stored with a comment. */
export const inlineImageUrl = (path: string) => (path.startsWith("/api/files/") ? path : `/api/files/inline-files/${path}`);
