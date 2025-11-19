/* Small robust improvements for hamburger responsiveness and overlay handling.
   - ensures menu toggles reliably
   - disables body scroll while menu is open on mobile
   - closes menu on orientation change or resize when appropriate
   - keeps ARIA attributes in sync
*/

(function(){
  const $ = id => document.getElementById(id)
  const MOBILE_BREAK = 700

  function setBodyScrollDisabled(disabled){
    document.body.style.overflow = disabled ? 'hidden' : ''
  }

  function toggleMenu(open){
    const editor = $('editorPanel')
    const overlay = $('overlay')
    const burger = $('burger')
    if(!editor || !overlay || !burger) return
    if(open){
      editor.classList.add('open')
      overlay.classList.add('show')
      burger.setAttribute('aria-expanded', 'true')
      setBodyScrollDisabled(true)
    } else {
      editor.classList.remove('open')
      overlay.classList.remove('show')
      burger.setAttribute('aria-expanded', 'false')
      setBodyScrollDisabled(false)
    }
  }

  function initMenu(){
    const burger = $('burger'), overlay = $('overlay'), closeEditor = $('closeEditor')
    if(burger){
      burger.addEventListener('click', (e) => {
        const editor = $('editorPanel')
        const isOpen = editor.classList.contains('open')
        toggleMenu(!isOpen)
      })
    }
    if(overlay){
      overlay.addEventListener('click', ()=> toggleMenu(false))
    }
    if(closeEditor){
      closeEditor.addEventListener('click', ()=> toggleMenu(false))
    }

    // Close menu when device rotates / resizes over breakpoint
    window.addEventListener('resize', () => {
      const w = window.innerWidth
      if(w > MOBILE_BREAK){
        // On larger screens, ensure the panel is not left open in overlay mode
        toggleMenu(false)
      }
    })
    window.addEventListener('orientationchange', ()=> toggleMenu(false))
  }

  // init on DOM ready
  document.addEventListener('DOMContentLoaded', () => {
    initMenu()
    // ensure initial state consistent
    setTimeout(()=> toggleMenu(false), 10)
  })

  // expose helper to other code if needed
  window.toggleMenu = toggleMenu
})()