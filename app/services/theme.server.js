// app/services/theme.server.js
// Is the Picklo cart block on the store's theme? Read-only (read_themes): public apps
// can't write theme files, so installation goes through a theme-editor deep link the
// merchant (or a collaborator) opens and saves.
const APP_BLOCK_HANDLE = "shipping-selector"; // extensions/rocourier-cart/blocks/shipping-selector.liquid
const numericId = (gid) => String(gid).split("/").pop();

export async function inspectTheme(admin, themeId) {
  const res = await admin.graphql(
    `query CartTemplate($themeId: ID!) {
      theme(id: $themeId) {
        files(filenames: ["templates/cart.json"], first: 1) {
          nodes { body { ... on OnlineStoreThemeFileBodyText { content } } }
        }
      }
    }`,
    { variables: { themeId } },
  );
  const data = await res.json();
  const file = data.data?.theme?.files?.nodes?.[0];
  const content = file?.body?.content || "";
  return { supportsAppBlocks: !!file, blockAdded: content.includes(`/blocks/${APP_BLOCK_HANDLE}/`) };
}

// Live theme first. → [{ id, name, live, supportsAppBlocks, blockAdded, editorUrl }]
export async function themeStatus(admin, shop) {
  const res = await admin.graphql(`{ themes(first: 25, roles: [MAIN, UNPUBLISHED]) { nodes { id name role } } }`);
  const themes = ((await res.json()).data?.themes?.nodes || []).sort((a, b) => (a.role === "MAIN" ? -1 : b.role === "MAIN" ? 1 : 0));
  const out = [];
  for (const t of themes.slice(0, 5)) {
    const info = await inspectTheme(admin, t.id).catch(() => ({ supportsAppBlocks: false, blockAdded: false }));
    out.push({ id: numericId(t.id), name: t.name, live: t.role === "MAIN", ...info, editorUrl: cartBlockLink(shop, numericId(t.id)) });
  }
  return out;
}

export const cartBlockLink = (shop, themeId) =>
  `https://${shop}/admin/themes/${themeId}/editor?template=cart&addAppBlockId=${process.env.SHOPIFY_API_KEY || ""}/${APP_BLOCK_HANDLE}&target=newAppsSection`;
