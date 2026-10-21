// Anti-lampeggio del tema scuro per le pagine pubbliche (componente server): prima del primo paint mette la classe `dark`
// su <html> se la persona ha scelto il tema scuro nell'app (stessa chiave del ThemeProvider). PublicTheme (client) la mantiene e la toglie uscendo.
const THEME_BOOT = `try{if(localStorage.getItem("spigolestay:theme")==="dark")document.documentElement.classList.add("dark")}catch(e){}`;

export default function PublicThemeBoot() {
  return <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />;
}
