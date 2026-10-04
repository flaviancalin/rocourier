// TEMPORARY debug endpoint — logs client-side errors from the embedded app frame.
export async function action({ request }) {
  const body = await request.text();
  console.log("[client-log]", body.slice(0, 2000));
  return new Response(null, { status: 204 });
}
