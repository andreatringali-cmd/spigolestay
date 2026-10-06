import { redirect } from "next/navigation";

// La vecchia dashboard è stata sostituita dalla nuova: chi ha ancora l'indirizzo /dashboard-2 salvato arriva alla Dashboard.
export default function Dashboard2Redirect() {
  redirect("/");
}
