/**
 * script.js — Complete application script for BAT_MEDIA invoice & receipt PWA
 *
 * Features included:
 * - Responsive hamburger slide menu with overlay
 * - Editor <> Preview synchronization for Invoice and Receipt
 * - Live totals, amount-in-words (bold + italic)
 * - QR generation for invoice & receipt (qrious)
 * - High-quality A4 export:
 *     - renderElementToA4Canvas(el, dpi): renders element to A4-sized canvas at chosen DPI
 *     - handleExportPNG: exports as PNG / JPEG / WebP (chosen format)
 *     - handleExportPDF: creates multi-page PDF with JPEG compression & configurable quality
 * - Preview modal showing exact exported image
 * - History and Sales saved to localStorage (grouped by day)
 * - PWA beforeinstallprompt handling with simple in-page install UI (no APK/TWA messaging)
 * - Service worker registration
 * - Helpers: toasts, file downloads, utilities
 *
 * Notes:
 * - This file expects html2canvas, jsPDF (window.jspdf) and qrious to be loaded in the page.
 * - It expects the DOM ids present in the provided index.html (headerLogoImg, signatureImg, qrInvoice, etc.).
 * - Place BAT LOGO.png, bat signature.png and icons (icon-192.png, icon-512.png) in your project root.
 *
 * Usage:
 * - Include this script at the bottom of index.html (after the DOM).
 * - On page load it attaches all UI wiring.
 */

/* ========= Short aliases ========= */
const $ = id => document.getElementById(id)

/* ========= Storage keys ========= */
const HISTORY_KEY = 'bat_media_history_final_v1'
const SALES_KEY = 'bat_media_sales_final_v1'

/* ========= Globals ========= */
let deferredInstallPrompt = null
let lastPreviewDataUrl = null

/* ========= Startup ========= */
window.addEventListener('load', () => {
  init()
})

/* ---------- init: wire UI, ensure starter rows, initial sync ---------- */
function init(){
  wireUI()
  ensureStarterRows()
  attachEditors()
  renderHistoryList()
  renderSales()
  syncAll()
  renderQRs()
  registerServiceWorker()
  wireExportControls()
  // Close menu on orientation change / resize beyond mobile breakpoint
  window.addEventListener('resize', ()=> {
    if(window.innerWidth > 700) toggleMenu(false)
  })
}

/* ========== UI Wiring ========== */
function wireUI(){
  // Hamburger
  const burger = $('burger'), overlay = $('overlay'), closeEditor = $('closeEditor')
  if(burger){
    burger.removeEventListener('click', burgerClickHandler)
    burger.addEventListener('click', burgerClickHandler)
  }
  if(overlay){
    overlay.removeEventListener('click', overlayClickHandler)
    overlay.addEventListener('click', overlayClickHandler)
  }
  if(closeEditor){
    closeEditor.removeEventListener('click', ()=> toggleMenu(false))
    closeEditor.addEventListener('click', ()=> toggleMenu(false))
  }

  // Tabs
  safeOn('tab-invoice','click', showInvoice)
  safeOn('tab-receipt','click', showReceipt)
  safeOn('tab-sales','click', showSales)

  // Editor buttons (some might be already wired by export wiring)
  safeOn('invAddRow','click', ()=> { invAddRow(); syncInvoiceEditorToPreview() })
  safeOn('invClear','click', ()=> { invClear(); syncInvoiceEditorToPreview() })
  safeOn('recAddRow','click', ()=> { recAddRow(); syncReceiptEditorToPreview() })
  safeOn('recClear','click', ()=> { recClear(); syncReceiptEditorToPreview() })

  safeOn('saveHistory','click', saveCurrentToHistory)
  safeOn('clearAll','click', ()=> { if(confirm('Reset all fields?')) location.reload() })

  // Preview modal close
  safeOn('closePreview','click', closePreviewModal)

  // Install prompt wiring (PWA only)
  setupInstallPrompt()
}

/* Safe addEvent: avoids duplicates */
function safeOn(id, event, handler){
  const el = $(id)
  if(!el) return
  el.removeEventListener(event, handler)
  el.addEventListener(event, handler)
}

/* ---------- Menu handlers ---------- */
function burgerClickHandler(){
  const editor = $('editorPanel'), overlay = $('overlay'), burger = $('burger')
  if(!editor || !overlay || !burger) return
  const open = !editor.classList.contains('open')
  toggleMenu(open)
  burger.setAttribute('aria-expanded', open ? 'true' : 'false')
}
function overlayClickHandler(){
  toggleMenu(false)
}
function toggleMenu(open){
  const editor = $('editorPanel'), overlay = $('overlay'), burger = $('burger')
  if(!editor || !overlay) return
  if(open){
    editor.classList.add('open')
    overlay.classList.add('show')
    document.body.style.overflow = 'hidden'
    if(burger) burger.setAttribute('aria-expanded','true')
  } else {
    editor.classList.remove('open')
    overlay.classList.remove('show')
    document.body.style.overflow = ''
    if(burger) burger.setAttribute('aria-expanded','false')
  }
}

/* ========== Editor rows and input helpers ========== */
function ensureStarterRows(){
  if($('invoiceEditorTable').querySelector('tbody').children.length === 0) invAddRow('Design work', 1, 30000)
  if($('receiptEditorTable').querySelector('tbody').children.length === 0) recAddRow('Design work', 1, 150000)
}

function invAddRow(desc='', qty=1, price=0){
  const tbody = $('invoiceEditorTable').querySelector('tbody')
  const tr = document.createElement('tr')
  tr.innerHTML = `<td><input class="inv-desc" value="${escapeHtml(desc)}" /></td>
    <td><input class="inv-qty" type="number" inputmode="numeric" min="0" value="${qty}" /></td>
    <td><input class="inv-price" type="number" inputmode="numeric" min="0" value="${price}" /></td>
    <td><button class="inv-remove btn subtle">Remove</button></td>`
  tbody.appendChild(tr)
}

function invClear(){ $('invoiceEditorTable').querySelector('tbody').innerHTML = '' }

function recAddRow(desc='', qty=1, unit=0){
  const tbody = $('receiptEditorTable').querySelector('tbody')
  const tr = document.createElement('tr')
  tr.innerHTML = `<td class="r-no">1</td>
    <td><input class="rec-desc" value="${escapeHtml(desc)}" /></td>
    <td><input class="rec-qty" type="number" inputmode="numeric" min="0" value="${qty}" /></td>
    <td><input class="rec-unit" type="number" inputmode="numeric" min="0" value="${unit}" /></td>
    <td><button class="rec-remove btn subtle">Remove</button></td>`
  tbody.appendChild(tr)
}

function recClear(){ $('receiptEditorTable').querySelector('tbody').innerHTML = '' }

function escapeHtml(s){ return (s||'').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }

/* Attach editor input and click delegation */
function attachEditors(){
  const invTable = $('invoiceEditorTable'), recTable = $('receiptEditorTable')

  if(invTable){
    invTable.addEventListener('input', ()=> syncInvoiceEditorToPreview())
    invTable.addEventListener('click', (e)=>{
      if(e.target.classList.contains('inv-remove')){ e.target.closest('tr').remove(); syncInvoiceEditorToPreview() }
    })
  }

  if(recTable){
    recTable.addEventListener('input', ()=> syncReceiptEditorToPreview())
    recTable.addEventListener('click', (e)=>{
      if(e.target.classList.contains('rec-remove')){ e.target.closest('tr').remove(); syncReceiptEditorToPreview() }
    })
  }

  // Generic fields syncing
  const fields = ['companyName','companyTag','companyAddress','docNo','docDate','billTo','reason','amountPaid']
  fields.forEach(id => {
    const el = $(id)
    if(el) el.addEventListener('input', ()=> { syncAll(); renderQRs() })
  })
}

/* ========== Sync editor -> preview and totals ========== */
function syncAll(){ syncFields(); syncInvoiceEditorToPreview(); syncReceiptEditorToPreview(); renderQRs(); renderSales() }

function syncFields(){
  setText('companyNameView', $('companyName').value)
  setText('companyTagView', $('companyTag').value)
  setText('companyAddressView', $('companyAddress').value.replace(/\n/g,'<br/>'))
  setText('companyNameViewR', $('companyName').value)
  setText('companyTagViewR', $('companyTag').value)
  setText('companyAddressViewR', $('companyAddress').value.replace(/\n/g,'<br/>'))
  setText('docNoView', $('docNo').value)
  setText('docNoViewR', $('docNo').value)
  const dateVal = $('docDate').value
  setText('docDateView', dateVal || new Date().toLocaleDateString())
  setText('docDateViewR', dateVal || new Date().toLocaleDateString())
  setText('billToView', $('billTo').value)
  setText('billToViewR', $('billTo').value)
  setText('reasonView', $('reason').value)
  setText('reasonViewR', $('reason').value)
  // signature visibility (embedded in HTML)
  const sig = $('signatureImg')
  if(sig && sig.src && !sig.src.includes('INSERT_SIGNATURE_SRC_HERE')) sig.style.display = 'block'
  const sigR = $('signatureImgR')
  if(sigR && sigR.src && !sigR.src.includes('INSERT_SIGNATURE_SRC_HERE')) sigR.style.display = 'block'
}

function getInvoiceTotal(){
  let total = 0
  Array.from($('invoiceEditorTable').querySelectorAll('tbody tr')).forEach(tr=>{
    const qty = Number(tr.querySelector('.inv-qty').value || 0)
    const price = Number(tr.querySelector('.inv-price').value || 0)
    total += qty * price
  })
  return Math.round(total)
}

function getReceiptTotal(){
  let total = 0
  Array.from($('receiptEditorTable').querySelectorAll('tbody tr')).forEach(tr=>{
    const qty = Number(tr.querySelector('.rec-qty').value || 0)
    const unit = Number(tr.querySelector('.rec-unit').value || 0)
    total += qty * unit
  })
  return Math.round(total)
}

function syncInvoiceEditorToPreview(){
  const tbody = $('itemsTable').querySelector('tbody'); tbody.innerHTML = ''
  Array.from($('invoiceEditorTable').querySelectorAll('tbody tr')).forEach(tr=>{
    const desc = tr.querySelector('.inv-desc').value || ''
    const qty = Number(tr.querySelector('.inv-qty').value || 0)
    const price = Number(tr.querySelector('.inv-price').value || 0)
    const row = document.createElement('tr')
    row.innerHTML = `<td>${escapeHtml(desc)}</td><td class="number">${qty}</td><td class="number">${formatNumber(price)}</td><td class="number">${formatNumber(qty*price)}</td>`
    tbody.appendChild(row)
  })
  const total = getInvoiceTotal()
  setText('totalValue', formatNumber(total))
  const paid = Number($('amountPaid').value || 0)
  setText('depositValue', formatNumber(paid))
  setText('balanceValue', formatNumber(Math.max(0, total - paid)))
  setText('amountWords', numberToWords(total) + ' only')
}

function syncReceiptEditorToPreview(){
  const tbody = $('receiptItems').querySelector('tbody'); tbody.innerHTML = ''
  Array.from($('receiptEditorTable').querySelectorAll('tbody tr')).forEach((tr, i)=>{
    const desc = tr.querySelector('.rec-desc').value || ''
    const qty = Number(tr.querySelector('.rec-qty').value || 0)
    const unit = Number(tr.querySelector('.rec-unit').value || 0)
    const total = qty * unit
    const row = document.createElement('tr')
    row.innerHTML = `<td>${i+1}</td><td>${escapeHtml(desc)}</td><td class="number">${qty}</td><td class="number">${formatNumber(unit)}</td><td class="number">${formatNumber(total)}</td>`
    tbody.appendChild(row)
  })
  const totalR = getReceiptTotal()
  setText('totalValueR', formatNumber(totalR))
  setText('amountWordsR', numberToWords(totalR) + ' only')
}

/* ========== QR generation ========== */
function renderQRs(){
  try{
    const invData = `INVOICE|No:${$('docNo').value}|Date:${$('docDate').value||new Date().toLocaleDateString()}|Total:${getInvoiceTotal()}`
    new QRious({ element: $('qrInvoice'), value: invData, size: 96 })
    const recData = `RECEIPT|No:${$('docNo').value}|Date:${$('docDate').value||new Date().toLocaleDateString()}|Total:${getReceiptTotal()}`
    new QRious({ element: $('qrReceipt'), value: recData, size: 96 })
  }catch(e){ console.warn('QR render failed', e) }
}

/* ========== Number to words (English, up to millions) ========== */
function numberToWords(amount){
  if(!amount) return 'Zero'
  const a = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen']
  const b = ['', '', 'Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety']
  function inHundreds(n){
    let s = ''
    if(n>=100){ s += a[Math.floor(n/100)] + ' Hundred '; n = n%100 }
    if(n>=20){ s += b[Math.floor(n/10)] + (n%10 ? ' ' + a[n%10] : '') }
    else if(n>0) s += a[n]
    return s.trim()
  }
  let words = ''
  if(amount >= 1000000){
    words += inHundreds(Math.floor(amount/1000000)) + ' Million '
    amount = amount % 1000000
  }
  if(amount >= 1000){
    words += inHundreds(Math.floor(amount/1000)) + ' Thousand '
    amount = amount % 1000
  }
  if(amount > 0){
    words += inHundreds(amount)
  }
  return words.trim()
}

/* ========== High-quality A4 export: render to canvas at A4 pixels, create multi-page PDF ========== */
/**
 * Render element to an A4-width canvas at requested DPI.
 * Ensures the clone is forced to the A4 pixel width, letting height flow (multi-page).
 * Returns a canvas that represents the full content width==A4px.
 */
const A4_IN_WIDTH = 8.27
const A4_IN_HEIGHT = 11.69

async function renderElementToA4Canvas(el, dpi = 300){
  if(!el) throw new Error('Element not found for A4 render')
  // capture QR canvases as images first
  const canvasEls = Array.from(el.querySelectorAll('canvas'))
  const canvasDataUrls = await Promise.all(canvasEls.map(async c => {
    try { return c.toDataURL('image/png') } catch(e) { return null }
  }))

  // clone element
  const clone = el.cloneNode(true)
  // replace canvases in clone
  const cloneCanvases = Array.from(clone.querySelectorAll('canvas'))
  cloneCanvases.forEach((c, idx)=>{
    const dataUrl = canvasDataUrls[idx]
    const img = document.createElement('img')
    if(dataUrl){ img.src = dataUrl; img.style.width = c.style.width || c.width + 'px'; img.style.height = c.style.height || c.height + 'px' }
    img.className = 'qr-image'
    c.parentNode.replaceChild(img, c)
  })

  // set exact pixel width for A4 at requested dpi
  const a4PxWidth = Math.round(A4_IN_WIDTH * dpi)
  clone.style.boxShadow = 'none'
  clone.style.transform = 'none'
  clone.style.margin = '0'
  clone.style.background = '#ffffff'
  clone.style.width = a4PxWidth + 'px'
  clone.style.maxWidth = a4PxWidth + 'px'
  clone.style.minWidth = a4PxWidth + 'px'
  clone.style.boxSizing = 'border-box'

  const wrapper = document.createElement('div')
  wrapper.style.position = 'fixed'
  wrapper.style.left = '-9999px'
  wrapper.style.top = '0'
  wrapper.appendChild(clone)
  document.body.appendChild(wrapper)

  // Render with html2canvas at scale 1 (since clone is pixel-perfect width)
  const canvas = await html2canvas(clone, { scale: 1, useCORS: true, backgroundColor: '#ffffff', logging: false })
  document.body.removeChild(wrapper)
  return canvas
}

/**
 * Convert a large canvas into a multi-page PDF by slicing the canvas vertically into A4-height chunks.
 * dpi must match renderElementToA4Canvas' dpi.
 */
async function canvasToMultiPagePDF(canvas, dpi = 300, jpegQuality = 0.9, filename = 'document.pdf'){
  const a4PxHeight = Math.round(A4_IN_HEIGHT * dpi)
  const canvasWidth = canvas.width, canvasHeight = canvas.height
  const pages = Math.ceil(canvasHeight / a4PxHeight)
  const { jsPDF } = window.jspdf
  const pdf = new jsPDF('p','mm','a4')

  for(let i=0;i<pages;i++){
    const sliceHeight = (i === pages - 1) ? (canvasHeight - i*a4PxHeight) : a4PxHeight
    const pageCanvas = document.createElement('canvas')
    pageCanvas.width = canvasWidth
    pageCanvas.height = sliceHeight
    const ctx = pageCanvas.getContext('2d')
    ctx.drawImage(canvas, 0, -i * a4PxHeight)
    const dataUrl = pageCanvas.toDataURL('image/jpeg', jpegQuality)
    const a4mm = { w: 210, h: 297 }
    const imgProps = { width: pageCanvas.width, height: pageCanvas.height }
    const imgHmm = (imgProps.height * a4mm.w) / imgProps.width
    if(i > 0) pdf.addPage()
    pdf.addImage(dataUrl, 'JPEG', 0, 0, a4mm.w, imgHmm, undefined, 'FAST')
  }

  pdf.save(filename)
}

/* Export handlers used by UI buttons */
async function handleExportPNG(){
  try{
    syncAll()
    const dpi = Number($('exportDPI').value || 200)
    const format = $('pngFormat') ? $('pngFormat').value : 'image/png' // 'image/png' | 'image/jpeg' | 'image/webp'
    const quality = (format === 'image/png') ? undefined : 0.92
    const docEl = $('invoice').classList.contains('hidden') ? $('receipt') : $('invoice')
    const canvas = await renderElementToA4Canvas(docEl, dpi)
    const blob = await new Promise((res, rej) => {
      try {
        canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob returned null'))), format, quality)
      } catch(err) { rej(err) }
    })
    const ext = format.split('/')[1]
    const filename = `${docEl.id}_${$('docNo').value || Date.now()}.${ext}`
    await downloadBlob(blob, filename)
    showToast('PNG exported')
  } catch(err){
    console.error(err); showToast('PNG export failed: ' + (err.message || 'error'))
  }
}

async function handleExportPDF(){
  try{
    syncAll()
    const dpi = Number($('exportDPI').value || 300)
    const quality = Number($('pdfQuality').value || 0.9)
    const docEl = $('invoice').classList.contains('hidden') ? $('receipt') : $('invoice')
    const canvas = await renderElementToA4Canvas(docEl, dpi)
    await canvasToMultiPagePDF(canvas, dpi, quality, `${docEl.id}_${$('docNo').value || Date.now()}.pdf`)
    showToast('PDF exported')
  } catch(err){
    console.error(err); showToast('PDF export failed: ' + (err.message || 'error'))
  }
}

/* Wire export buttons (call once) */
function wireExportControls(){
  const pngBtn = $('exportPNG'), pdfBtn = $('exportPDF'), previewBtn = $('previewBtn')
  if(pngBtn){ pngBtn.removeEventListener('click', handleExportPNG); pngBtn.addEventListener('click', handleExportPNG) }
  if(pdfBtn){ pdfBtn.removeEventListener('click', handleExportPDF); pdfBtn.addEventListener('click', handleExportPDF) }
  if(previewBtn){
    previewBtn.removeEventListener('click', asyncPreviewHandler)
    previewBtn.addEventListener('click', asyncPreviewHandler)
  }
}

/* Preview button: create A4 canvas at chosen DPI and show dataURL in modal */
async function asyncPreviewHandler(){
  try{
    syncAll()
    const dpi = Number($('exportDPI').value || 200)
    const docEl = $('invoice').classList.contains('hidden') ? $('receipt') : $('invoice')
    const canvas = await renderElementToA4Canvas(docEl, dpi)
    lastPreviewDataUrl = canvas.toDataURL('image/png')
    $('previewImage').src = lastPreviewDataUrl
    openPreviewModal()
  } catch(err){
    console.error(err); showToast('Preview failed: ' + (err.message || 'error'))
  }
}

/* ========== History & Sales (localStorage) ========== */
function loadHistory(){ const raw = localStorage.getItem(HISTORY_KEY); return raw ? JSON.parse(raw) : [] }
function saveHistory(arr){ localStorage.setItem(HISTORY_KEY, JSON.stringify(arr)); renderHistoryList() }
function loadSales(){ const raw = localStorage.getItem(SALES_KEY); return raw ? JSON.parse(raw) : [] }
function saveSales(arr){ localStorage.setItem(SALES_KEY, JSON.stringify(arr)); renderSales() }
function addSaleRecord(record){ const arr = loadSales(); arr.unshift(record); saveSales(arr) }

async function saveCurrentToHistory(){
  const snap = makeSnapshotData()
  snap.thumb = await createThumbnailForSnapshot(snap.type)
  const hist = loadHistory(); hist.unshift(snap); saveHistory(hist)
  addSaleRecord({ id: Date.now(), createdAt: new Date().toISOString(), type: snap.type, docNo: snap.meta.docNo, customer: snap.meta.billTo, total: snap.total||0, paid: snap.paid||0 })
  renderHistoryList(); renderSales()
  showToast('Saved to history')
}

function makeSnapshotData(){
  const signatureData = ($('signatureImg') && $('signatureImg').src) ? $('signatureImg').src : ''
  const logoData = ($('headerLogoImg') && $('headerLogoImg').src) ? $('headerLogoImg').src : ''
  const items = Array.from($('invoiceEditorTable').querySelectorAll('tbody tr')).map(tr => ({ desc: tr.querySelector('.inv-desc').value || '', qty: Number(tr.querySelector('.inv-qty').value||0), price: Number(tr.querySelector('.inv-price').value||0) }))
  const ritems = Array.from($('receiptEditorTable').querySelectorAll('tbody tr')).map(tr => ({ desc: tr.querySelector('.rec-desc').value || '', qty: Number(tr.querySelector('.rec-qty').value||0), unit: Number(tr.querySelector('.rec-unit').value||0) }))
  const total = getInvoiceTotal()
  const paid = Number($('amountPaid').value || 0)
  const type = $('invoice').classList.contains('hidden') ? 'receipt' : 'invoice'
  return { id: Date.now(), createdAt: new Date().toISOString(), type, meta:{ companyName: $('companyName').value, docNo: $('docNo').value, billTo: $('billTo').value }, images:{ logo: logoData, signature: signatureData }, items, ritems, total, paid }
}

async function createThumbnailForSnapshot(docType){
  const docEl = docType === 'receipt' ? $('receipt') : $('invoice')
  const canvas = await renderElementToA4Canvas(docEl, 150)
  const TH_W = 220
  const scale = TH_W / canvas.width
  const thumb = document.createElement('canvas')
  thumb.width = TH_W
  thumb.height = Math.round(canvas.height * scale)
  const ctx = thumb.getContext('2d')
  ctx.drawImage(canvas, 0, 0, thumb.width, thumb.height)
  return thumb.toDataURL('image/png')
}

function renderHistoryList(){
  const list = loadHistory(); const container = $('historyList'); if(!container) return
  container.innerHTML = ''
  if(list.length === 0){ container.innerHTML = '<div class="hint">No saved history yet.</div>'; return }
  list.forEach(item=>{
    const div = document.createElement('div'); div.className = 'history-item'
    div.innerHTML = `<div><strong>${item.type.toUpperCase()}</strong> No:${item.meta.docNo} • ${new Date(item.createdAt).toLocaleString()}</div>
      <div><button class="btn load" data-id="${item.id}">Load</button> <button class="btn download" data-id="${item.id}">Download</button> <button class="btn subtle delete" data-id="${item.id}">Delete</button></div>`
    container.appendChild(div)
  })
  container.querySelectorAll('button.load').forEach(b => b.onclick = ()=> loadHistoryItem(Number(b.dataset.id)))
  container.querySelectorAll('button.delete').forEach(b => b.onclick = ()=> {
    const id = Number(b.dataset.id); const arr = loadHistory().filter(i=>i.id!==id); saveHistory(arr)
  })
  container.querySelectorAll('button.download').forEach(b => b.onclick = async ()=>{
    const id = Number(b.dataset.id); const item = loadHistory().find(i=>i.id===id); if(!item) return
    applySnapshotToUI(item)
    await new Promise(r=>setTimeout(r,250))
    const docEl = item.type==='receipt' ? $('receipt') : $('invoice')
    const canvas = await renderElementToA4Canvas(docEl, Number($('exportDPI').value||200))
    const blob = await new Promise((res,rej)=> canvas.toBlob(res,'image/png'))
    await downloadBlob(blob, `${item.type}_${item.meta.docNo || item.id}.png`)
  })
}

function loadHistoryItem(id){
  const item = loadHistory().find(i=>i.id===id); if(!item) return; applySnapshotToUI(item)
}

function applySnapshotToUI(snapshot){
  $('companyName').value = snapshot.meta.companyName || ''
  $('docNo').value = snapshot.meta.docNo || ''
  $('billTo').value = snapshot.meta.billTo || ''
  if(snapshot.images && snapshot.images.signature){ if($('signatureImg')){ $('signatureImg').src = snapshot.images.signature; $('signatureImg').style.display = 'block' }; if($('signatureImgR')){ $('signatureImgR').src = snapshot.images.signature; $('signatureImgR').style.display = 'block' } }
  if(snapshot.images && snapshot.images.logo){ if($('headerLogoImg')) $('headerLogoImg').src = snapshot.images.logo; if($('headerLogoImgR')) $('headerLogoImgR').src = snapshot.images.logo }
  invClear(); snapshot.items.forEach(it => invAddRow(it.desc,it.qty,it.price))
  recClear(); snapshot.ritems.forEach(it => recAddRow(it.desc,it.qty,it.unit))
  $('amountPaid').value = snapshot.paid || 0
  if(snapshot.type === 'receipt') showReceipt(); else showInvoice()
  syncAll()
}

/* ========== Preview modal ========== */
function openPreviewModal(){ const m = $('previewModal'); if(m) m.classList.add('show'); }
function closePreviewModal(){ const m = $('previewModal'); if(m) m.classList.remove('show') }

/* ========== Sales rendering ========== */
function renderSales(){
  const sales = loadSales()
  const summary = $('salesSummary'); if(summary) summary.innerHTML = `<div><strong>Total Entries:</strong> ${sales.length}</div><div><strong>Total Amount:</strong> ${formatNumber(sales.reduce((s,x)=> s + (Number(x.total)||0),0))} UGX</div>`
  const byDay = {}
  sales.forEach(s => { const day = new Date(s.createdAt).toLocaleDateString(); (byDay[day]=byDay[day]||[]).push(s) })
  const container = $('salesByDay'); if(!container) return; container.innerHTML = ''
  Object.keys(byDay).sort((a,b)=> new Date(b)-new Date(a)).forEach(day=>{
    const block = document.createElement('div'); block.className='sales-day'
    const dayTotal = byDay[day].reduce((s,x)=> s + (Number(x.total)||0),0)
    block.innerHTML = `<div style="display:flex;justify-content:space-between"><strong>${day}</strong><span>Total: ${formatNumber(dayTotal)} UGX</span></div>`
    byDay[day].forEach(sale => {
      const row = document.createElement('div'); row.className='sales-entry'
      row.innerHTML = `<div>${sale.docNo} • ${sale.customer}</div><div>${formatNumber(sale.total)} UGX</div>`
      block.appendChild(row)
    })
    container.appendChild(block)
  })
}

/* ========== Helpers ========== */
function setText(id, text){ const el = $(id); if(el) el.innerHTML = text }
function formatNumber(n){ return Intl.NumberFormat().format(Number(n||0)) }

/* ========== PWA Install prompt (PWA only) ========== */
function setupInstallPrompt(){
  window.addEventListener('beforeinstallprompt', (e)=>{
    e.preventDefault()
    deferredInstallPrompt = e
    const installEl = $('installPrompt'), headerBtn = $('installBtn')
    if(installEl){ installEl.hidden = false; installEl.setAttribute('aria-hidden','false') }
    if(headerBtn) headerBtn.style.display = 'inline-block'
  })

  // Install Now button
  const installNow = $('installNow'), installLater = $('installLater'), installHeader = $('installBtn')
  if(installNow) installNow.addEventListener('click', async ()=>{
    if(!deferredInstallPrompt){ showToast('Install not available'); return }
    const el = $('installPrompt'); if(el){ el.hidden = true; el.setAttribute('aria-hidden','true') }
    deferredInstallPrompt.prompt()
    const choice = await deferredInstallPrompt.userChoice
    if(choice && choice.outcome === 'accepted') showToast('App installed')
    else showToast('Install cancelled')
    deferredInstallPrompt = null
    if(installHeader) installHeader.style.display = 'none'
  })
  if(installLater) installLater.addEventListener('click', ()=>{
    const el = $('installPrompt'); if(el){ el.hidden = true; el.setAttribute('aria-hidden','true') }
    if($('installBtn')) $('installBtn').style.display = 'none'
  })
  if(installHeader) installHeader.addEventListener('click', async ()=>{
    if(!deferredInstallPrompt){ showToast('Install not available'); return }
    deferredInstallPrompt.prompt()
    const choice = await deferredInstallPrompt.userChoice
    if(choice && choice.outcome === 'accepted') showToast('App installed')
    else showToast('Install cancelled')
    deferredInstallPrompt = null
    installHeader.style.display = 'none'
    const el = $('installPrompt'); if(el){ el.hidden = true; el.setAttribute('aria-hidden','true') }
  })
  window.addEventListener('appinstalled', ()=> {
    const el = $('installPrompt'); if(el){ el.hidden = true; el.setAttribute('aria-hidden','true') }
    if($('installBtn')) $('installBtn').style.display = 'none'
    showToast('App installed')
  })
}

/* ========== Service worker registration ========== */
function registerServiceWorker(){
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('service-worker.js').then(()=> console.log('Service worker registered')).catch(e=> console.warn('SW failed', e))
  }
}

/* ========== Small utilities exposed globally if needed ========== */
window.showToast = showToast
window.toggleMenu = toggleMenu
window.handleExportPNG = handleExportPNG
window.handleExportPDF = handleExportPDF
window.renderElementToA4Canvas = renderElementToA4Canvas
window.wireExportControls = wireExportControls

/* End of file */