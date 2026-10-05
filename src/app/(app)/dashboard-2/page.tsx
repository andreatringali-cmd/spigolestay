import { redirect } from "next/navigation";

// La vecchia "Dashboard 2" è diventata la Dashboard principale: i vecchi link e segnalibri portano lì.
export default function Dashboard2Redirect() {
  redirect("/");
}
