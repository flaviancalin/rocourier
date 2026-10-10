// app/routes/hq_.logout.jsx
import { logout } from "../services/hq-auth.server.js";
export const action = ({ request }) => logout(request);
export const loader = ({ request }) => logout(request);
