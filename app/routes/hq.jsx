// app/routes/hq.jsx — layout + auth guard for the Picklo team dashboard (/hq/*)
import { json } from "@remix-run/node";
import { Outlet, useLoaderData } from "@remix-run/react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { requireTeam } from "../services/hq-auth.server.js";
import { prisma } from "../db.server.js";
import { HqProvider, HqShell } from "../components/hq/HqShell.jsx";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];
export const meta = () => [{ title: "Picklo HQ" }, { name: "robots", content: "noindex, nofollow" }];

export async function loader({ request }) {
  const member = await requireTeam(request);
  const unread = await prisma.supportTicket.count({ where: { unreadByTeam: true, status: { not: "resolved" } } });
  return json({ member, counts: { unread } });
}

export default function HqLayout() {
  const { member, counts } = useLoaderData();
  return (
    <HqProvider>
      <HqShell member={member} counts={counts}>
        <Outlet />
      </HqShell>
    </HqProvider>
  );
}
