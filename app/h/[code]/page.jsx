"use client";

import { use } from "react";
import Login from "../../../components/Login";

/**
 * A hotel's own sign-in link: easyroom.app/h/{code}. Its staff are sent it
 * once — by WhatsApp, or as the QR code printed for the desk — and sign in
 * on a screen that already carries their hotel's name.
 */
export default function Page({ params }) {
  const { code } = use(params);
  return <Login linkedHotel={code} />;
}
