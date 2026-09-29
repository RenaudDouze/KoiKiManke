// `position: fixed` ancre un élément au viewport de mise en page (layout
// viewport), pas au viewport visuel : quand le clavier virtuel s'ouvre sur
// mobile, ce dernier rétrécit sans que le premier ne bouge, et un élément
// fixe ancré en bas (les toasts, voir style.css) se retrouve caché derrière
// le clavier au lieu de rester juste au-dessus. Reflète l'écart entre les
// deux dans la variable CSS --keyboard-inset sur <html>, lue par style.css
// pour compenser. Pas d'effet (le clavier ne pouvant pas s'ouvrir) sur un
// navigateur sans Visual Viewport API.
export function watchKeyboardInset(): () => void {
  const vv = window.visualViewport;
  if (!vv) return () => {};

  function update(): void {
    const inset = Math.max(0, window.innerHeight - vv!.height - vv!.offsetTop);
    document.documentElement.style.setProperty("--keyboard-inset", `${inset}px`);
  }

  update();
  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
  return () => {
    vv.removeEventListener("resize", update);
    vv.removeEventListener("scroll", update);
    document.documentElement.style.removeProperty("--keyboard-inset");
  };
}
