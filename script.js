/* Main script for the BAT_MEDIA PWA
   Features:
   - Editor <-> Preview syncing
   - History & Sales in localStorage
   - QR generation
   - Preview (high-res) and exports (PNG A4, PDF with JPEG compression)
   - PWA install prompt (beforeinstallprompt -> in-page prompt)
   - Responsive hamburger + overlay handling
*/

const q = id => document.getElementById(id)

/* Keys */
const HISTORY_KEY = 'bat_media_history_final'
const SALES_KEY = 'bat_media_sales_final'

/* Init */
window.addEventListener('load', () => {
  init()
})

function init(){
  wireUI()
  ensureStarterRows()
  attachEditors()
  renderHistoryList()
  renderSales()
  syncAll()
  renderQRs()
  registerServiceWorker()
}

/* Wire UI: hamburger, tabs, install prompt, export controls */
function wireUI(){
  // hamburger & overlay
  const burger = q('burger'), overlay = q('overlay'), closeEditor = q('closeEditor'), editorPanel = q('editorPanel')
  if(burger){
    burger.removeEventListener('click', burgerClickHandler)
    burger.addEventListener('click', burgerClickHandler)
  }
  if(overlay){
    overlay.removeEventListener('click', ()=> toggleMenu(false))
    overlay.addEventListener('click', ()=> toggleMenu(false))
  }
  if(closeEditor) closeEditor.addEventListener('click', ()=> toggleMenu(false))
  window.addEventListener('resize', ()=> { if(window.innerWidth > 700) toggleMenu(false) })

  // tabs
  q('tab-invoice').addEventListener('click', ()=> { showInvoice() })
  q('tab-receipt').addEventListener('click', ()=> { showReceipt() })
  q('tab-sales').addEventListener('click', ()=> { showSales() })

  // editor actions
  q('invAddRow').addEventListener('click', ()=> { invAddRow(); syncInvoiceEditorToPreview() })
  q('invClear').addEventListener('click', ()=> { invClear(); syncInvoiceEditorToPreview() })
  q('recAddRow').addEventListener('click', ()=> { recAddRow(); syncReceiptEditorToPreview() })
  q('recClear').addEventListener('click', ()=> { recClear(); syncReceiptEditorToPreview() })

  q('amountPaid').addEventListener('input', ()=> { syncAll(); renderQRs() })

  q('pdfQuality').addEventListener('input', ()=> q('pdfQualityValue').innerText = q('pdfQuality').value)

  // preview & export
  q('previewBtn').addEventListener('click', async ()=>{
    syncAll()
    const docEl = q('invoice').classList.contains('hidden') ? q('receipt') : q('invoice')
    const canvas = await renderElementHighRes(docEl, Number(q('exportDPI').value))
    const dataUrl = canvas.toDataURL('image/png')
    q('previewImage').src = dataUrl
    lastPreviewDataUrl = dataUrl
    openPreviewModal()
  })

  q('exportPNG').addEventListener('click', async ()=>{
    syncAll()
    const dpi = Number(q('exportDPI').value)
    const docEl = q('invoice').classList.contains('hidden') ? q('receipt') : q('invoice')
    const canvas = await renderElementHighRes(docEl, dpi)
    canvas.toBlob(async (blob)=> {
      await downloadBlob(blob, `${docEl.id}_${q('docNo').value || Date.now()}.png`)
    }, 'image/png')
  })

  q('exportPDF').addEventListener('click', async ()=>{
    syncAll()
    const dpi = Number(q('exportDPI').value)
    const quality = Number(q('pdfQuality').value) || 0.85
    const docEl = q('invoice').classList.contains('hidden') ? q('receipt') : q('invoice')
    const canvas = await renderElementHighRes(docEl, dpi)
    const jpgData = canvas.toDataURL('image/jpeg', quality)
    const { jsPDF } = window.jspdf
    const pdf = new jsPDF('p','mm','a4')
    const img = new Image()
    img.src = jpgData
    img.onload = () => {
      const a4mm = { w:210, h:297 }
      const imgHmm = (img.height * a4mm.w) / img.width
      pdf.addImage(jpgData, 'JPEG', 0, 0, a4mm.w, imgHmm)
      pdf.save(`${docEl.id}_${q('docNo').value || Date.now()}.pdf`)
    }
  })

  // preview modal downloads
  q('modalDownloadPNG').addEventListener('click', async ()=>{
    if(!lastPreviewDataUrl) return
    const blob = dataURLToBlob(lastPreviewDataUrl)
    await downloadBlob(blob, `preview_${Date.now()}.png`)
  })
  q('modalDownloadPDF').addEventListener('click', async ()=>{
    if(!lastPreviewDataUrl) return
    const { jsPDF } = window.jspdf
    const img = lastPreviewDataUrl
    const pdf = new jsPDF('p','mm','a4')
    const imgObj = new Image(); imgObj.src = img
    imgObj.onload = () => {
      const a4mm = { w:210, h:297 }
      const imgHmm = (imgObj.height * a4mm.w) / imgObj.width
      pdf.addImage(img, 'JPEG', 0, 0, a4mm.w, imgHmm)
      pdf.save(`preview_${Date.now()}.pdf`)
    }
  })

  // history save
  q('saveHistory').addEventListener('click', async ()=>{
    const snap = makeSnapshotData()
    snap.thumb = await createThumbnailForSnapshot(snap.type)
    const arr = loadHistory(); arr.unshift(snap); saveHistory(arr)
    addSaleRecord({ id: Date.now(), createdAt: new Date().toISOString(), type: snap.type, docNo: snap.meta.docNo, customer: snap.meta.billTo, total: snap.total || 0, paid: snap.paid || 0 })
    renderHistoryList(); renderSales()
    showToast('Saved to history')
  })

  q('clearAll').addEventListener('click', ()=> { if(confirm('Reset all fields?')) location.reload() })

  // install prompt (PWA only)
  setupInstallPrompt()
}

/* Hamburger handler */
function burgerClickHandler(){
  const editor = q('editorPanel')
  const overlay = q('overlay')
  const burger = q('burger')
  const open = !editor.classList.contains('open')
  editor.classList.toggle('open', open)
  overlay.classList.toggle('show', open)
  burger.setAttribute('aria-expanded', open ? 'true' : 'false')
  document.body.style.overflow = open ? 'hidden' : ''
}
function toggleMenu(open){ const editor = q('editorPanel'), overlay = q('overlay'), burger = q('burger'); if(open){ editor.classList.add('open'); overlay.classList.add('show'); burger.setAttribute('aria-expanded','true'); document.body.style.overflow='hidden' } else { editor.classList.remove('open'); overlay.classList.remove('show'); burger.setAttribute('aria-expanded','false'); document.body.style.overflow='' } }

/* PWA install prompt flow (no APK instructions) */
let deferredInstallPrompt = null
function setupInstallPrompt(){
  const installPromptEl = q('installPrompt'), installNow = q('installNow'), installLater = q('installLater'), installHeaderBtn = q('installBtn')
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredInstallPrompt = e
    if(installPromptEl) { installPromptEl.hidden = false; installPromptEl.setAttribute('aria-hidden','false') }
    if(installHeaderBtn) installHeaderBtn.style.display = 'inline-block'
  })

  if(installNow){
    installNow.addEventListener('click', async ()=>{
      if(!deferredInstallPrompt){ showToast('Install not available'); return }
      if(installPromptEl){ installPromptEl.hidden = true; installPromptEl.setAttribute('aria-hidden','true') }
      deferredInstallPrompt.prompt()
      const choice = await deferredInstallPrompt.userChoice
      if(choice && choice.outcome === 'accepted') showToast('App installed')
      else showToast('Install cancelled')
      deferredInstallPrompt = null
      if(installHeaderBtn) installHeaderBtn.style.display = 'none'
    })
  }
  if(installLater){
    installLater.addEventListener('click', ()=>{
      if(installPromptEl){ installPromptEl.hidden = true; installPromptEl.setAttribute('aria-hidden','true') }
      if(installHeaderBtn) installHeaderBtn.style.display = 'none'
    })
  }
  if(installHeaderBtn){
    installHeaderBtn.addEventListener('click', async ()=>{
      if(!deferredInstallPrompt){ showToast('Install not available'); return }
      deferredInstallPrompt.prompt()
      const choice = await deferredInstallPrompt.userChoice
      if(choice && choice.outcome === 'accepted') showToast('App installed')
      else showToast('Install cancelled')
      deferredInstallPrompt = null
      installHeaderBtn.style.display = 'none'
      if(installPromptEl){ installPromptEl.hidden = true; installPromptEl.setAttribute('aria-hidden','true') }
    })
  }
  window.addEventListener('appinstalled', ()=> { if(q('installPrompt')){ q('installPrompt').hidden = true }; if(q('installBtn')) q('installBtn').style.display = 'none'; showToast('App installed') })
}

/* Ensure starter rows */
function ensureStarterRows(){
  if(q('invoiceEditorTable').querySelector('tbody').children.length === 0) invAddRow('Design work',1,30000)
  if(q('receiptEditorTable').querySelector('tbody').children.length === 0) recAddRow('Design work',1,150000)
}

/* Editor row helpers */
function invAddRow(desc='', qty=1, price=0){
  const tbody = q('invoiceEditorTable').querySelector('tbody')
  const tr = document.createElement('tr')
  tr.innerHTML = `<td><input class="inv-desc" value="${escapeHtml(desc)}" /></td>
    <td><input class="inv-qty" type="number" inputmode="numeric" min="0" value="${qty}" /></td>
    <td><input class="inv-price" type="number" inputmode="numeric" min="0" value="${price}" /></td>
    <td><button class="inv-remove btn subtle">Remove</button></td>`
  tbody.appendChild(tr)
}
function invClear(){ q('invoiceEditorTable').querySelector('tbody').innerHTML = '' }
function recAddRow(desc='', qty=1, unit=0){
  const tbody = q('receiptEditorTable').querySelector('tbody')
  const tr = document.createElement('tr')
  tr.innerHTML = `<td class="r-no">1</td>
    <td><input class="rec-desc" value="${escapeHtml(desc)}" /></td>
    <td><input class="rec-qty" type="number" inputmode="numeric" min="0" value="${qty}" /></td>
    <td><input class="rec-unit" type="number" inputmode="numeric" min="0" value="${unit}" /></td>
    <td><button class="rec-remove btn subtle">Remove</button></td>`
  tbody.appendChild(tr)
}
function recClear(){ q('receiptEditorTable').querySelector('tbody').innerHTML = '' }
function escapeHtml(s){ return (s||'').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }

/* Attach editor delegations */
function attachEditors(){
  q('invoiceEditorTable').addEventListener('input', ()=> syncInvoiceEditorToPreview())
  q('invoiceEditorTable').addEventListener('click', (e)=> { if(e.target.classList.contains('inv-remove')){ e.target.closest('tr').remove(); syncInvoiceEditorToPreview() } })
  q('receiptEditorTable').addEventListener('input', ()=> syncReceiptEditorToPreview())
  q('receiptEditorTable').addEventListener('click', (e)=> { if(e.target.classList.contains('rec-remove')){ e.target.closest('tr').remove(); syncReceiptEditorToPreview() } })
}

/* Sync & totals & QR */
function syncAll(){ syncFields(); syncInvoiceEditorToPreview(); syncReceiptEditorToPreview(); renderQRs(); renderSales() }
function syncFields(){
  setText('companyNameView', q('companyName').value)
  setText('companyTagView', q('companyTag').value)
  setText('companyAddressView', q('companyAddress').value.replace(/\n/g,'<br/>'))
  setText('companyNameViewR', q('companyName').value)
  setText('companyTagViewR', q('companyTag').value)
  setText('companyAddressViewR', q('companyAddress').value.replace(/\n/g,'<br/>'))
  setText('docNoView', q('docNo').value)
  setText('docNoViewR', q('docNo').value)
  const dateVal = q('docDate').value
  setText('docDateView', dateVal || new Date().toLocaleDateString())
  setText('docDateViewR', dateVal || new Date().toLocaleDateString())
  setText('billToView', q('billTo').value)
  setText('billToViewR', q('billTo').value)
  setText('reasonView', q('reason').value)
  setText('reasonViewR', q('reason').value)
  if(q('signatureImg') && q('signatureImg').src && q('signatureImg').src.indexOf('INSERT_SIGNATURE_SRC_HERE') === -1) q('signatureImg').style.display = 'block'
  if(q('signatureImgR') && q('signatureImgR').src && q('signatureImgR').src.indexOf('INSERT_SIGNATURE_SRC_HERE') === -1) q('signatureImgR').style.display = 'block'
}

function getInvoiceTotal(){
  let total = 0
  Array.from(q('invoiceEditorTable').querySelectorAll('tbody tr')).forEach(tr=>{
    const qty = Number(tr.querySelector('.inv-qty').value || 0)
    const price = Number(tr.querySelector('.inv-price').value || 0)
    total += qty * price
  })
  return Math.round(total)
}
function getReceiptTotal(){
  let total = 0
  Array.from(q('receiptEditorTable').querySelectorAll('tbody tr')).forEach(tr=>{
    const qty = Number(tr.querySelector('.rec-qty').value || 0)
    const unit = Number(tr.querySelector('.rec-unit').value || 0)
    total += qty * unit
  })
  return Math.round(total)
}

function syncInvoiceEditorToPreview(){
  const tbody = q('itemsTable').querySelector('tbody'); tbody.innerHTML = ''
  Array.from(q('invoiceEditorTable').querySelectorAll('tbody tr')).forEach(tr=>{
    const desc = tr.querySelector('.inv-desc').value || ''
    const qty = Number(tr.querySelector('.inv-qty').value || 0)
    const price = Number(tr.querySelector('.inv-price').value || 0)
    const row = document.createElement('tr')
    row.innerHTML = `<td>${escapeHtml(desc)}</td><td class="number">${qty}</td><td class="number">${formatNumber(price)}</td><td class="number">${formatNumber(qty*price)}</td>`
    tbody.appendChild(row)
  })
  const total = getInvoiceTotal()
  setText('totalValue', formatNumber(total))
  const paid = Number(q('amountPaid').value || 0)
  setText('depositValue', formatNumber(paid))
  setText('balanceValue', formatNumber(Math.max(0, total - paid)))
  setText('amountWords', numberToWords(total) + ' only')
}

function syncReceiptEditorToPreview(){
  const tbody = q('receiptItems').querySelector('tbody'); tbody.innerHTML = ''
  Array.from(q('receiptEditorTable').querySelectorAll('tbody tr')).forEach((tr, i)=>{
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

/* QR generation */
function renderQRs(){
  try{
    const invData = `INVOICE|No:${q('docNo').value}|Date:${q('docDate').value||new Date().toLocaleDateString()}|Total:${getInvoiceTotal()}`
    new QRious({ element: q('qrInvoice'), value: invData, size: 96 })
    const recData = `RECEIPT|No:${q('docNo').value}|Date:${q('docDate').value||new Date().toLocaleDateString()}|Total:${getReceiptTotal()}`
    new QRious({ element: q('qrReceipt'), value: recData, size: 96 })
  }catch(e){ console.warn('QR failed', e) }
}

/* number-to-words */
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

/* Preview modal helpers */
function openPreviewModal(){ q('previewModal').classList.add('show'); q('previewModal').ariaHidden = 'false' }
function closePreviewModal(){ q('previewModal').classList.remove('show'); q('previewModal').ariaHidden = 'true' }
q('closePreview') && q('closePreview').addEventListener('click', closePreviewModal)

/* Render high-res via html2canvas (replaces QR canvas with images first) */
async function renderElementHighRes(el, dpi = 200){
  const canvasEls = Array.from(el.querySelectorAll('canvas'))
  const canvasDataUrls = await Promise.all(canvasEls.map(async c => { try { return c.toDataURL('image/png') } catch(e) { return null } }))
  const clone = el.cloneNode(true)
  const cloneCanvases = Array.from(clone.querySelectorAll('canvas'))
  cloneCanvases.forEach((c, idx) => {
    const dataUrl = canvasDataUrls[idx]
    const img = document.createElement('img')
    if(dataUrl){ img.src = dataUrl; img.style.width = c.style.width || c.width + 'px'; img.style.height = c.style.height || c.height + 'px' }
    img.className = 'qr-image'
    c.parentNode.replaceChild(img, c)
  })
  clone.style.boxShadow='none'; clone.style.transform='none'; clone.style.margin='0'; clone.style.background='#ffffff'
  const wrapper = document.createElement('div'); wrapper.style.position='fixed'; wrapper.style.left='-9999px'; wrapper.appendChild(clone); document.body.appendChild(wrapper)
  const A4_PX_WIDTH = Math.round(8.27 * dpi)
  const elWidth = el.offsetWidth || 794
  const scale = Math.max(1, A4_PX_WIDTH / elWidth)
  const canvas = await html2canvas(clone, { scale, useCORS:true, backgroundColor:'#ffffff' })
  document.body.removeChild(wrapper)
  return canvas
}

/* Utilities */
async function downloadBlob(blob, filename){ const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url) }
function dataURLToBlob(dataurl){ const arr = dataurl.split(','), mime = arr[0].match(/:(.*?);/)[1], bstr = atob(arr[1]), n = bstr.length, u8arr = new Uint8Array(n); for(let i=0;i<n;i++) u8arr[i]=bstr.charCodeAt(i); return new Blob([u8arr], {type:mime}) }
function showToast(msg, t=1800){ const el = q('toast'); if(!el) return; el.innerText = msg; el.classList.add('show'); setTimeout(()=> el.classList.remove('show'), t) }

/* History & Sales storage */
function loadHistory(){ const raw = localStorage.getItem(HISTORY_KEY); return raw ? JSON.parse(raw) : [] }
function saveHistory(arr){ localStorage.setItem(HISTORY_KEY, JSON.stringify(arr)); renderHistoryList() }
function loadSales(){ const raw = localStorage.getItem(SALES_KEY); return raw ? JSON.parse(raw) : [] }
function saveSales(arr){ localStorage.setItem(SALES_KEY, JSON.stringify(arr)); renderSales() }
function addSaleRecord(record){ const arr = loadSales(); arr.unshift(record); saveSales(arr) }

/* Make snapshot */
function makeSnapshotData(){
  const signatureData = (q('signatureImg') && q('signatureImg').src) ? q('signatureImg').src : ''
  const logoData = (q('headerLogoImg') && q('headerLogoImg').src) ? q('headerLogoImg').src : ''
  const items = Array.from(q('invoiceEditorTable').querySelectorAll('tbody tr')).map(tr => ({ desc: tr.querySelector('.inv-desc').value || '', qty: Number(tr.querySelector('.inv-qty').value||0), price: Number(tr.querySelector('.inv-price').value||0) }))
  const ritems = Array.from(q('receiptEditorTable').querySelectorAll('tbody tr')).map(tr => ({ desc: tr.querySelector('.rec-desc').value || '', qty: Number(tr.querySelector('.rec-qty').value||0), unit: Number(tr.querySelector('.rec-unit').value||0) }))
  const total = getInvoiceTotal()
  const paid = Number(q('amountPaid').value || 0)
  const type = q('invoice').classList.contains('hidden') ? 'receipt' : 'invoice'
  return { id: Date.now(), createdAt: new Date().toISOString(), type, meta:{ companyName: q('companyName').value, docNo: q('docNo').value, billTo: q('billTo').value }, images:{ logo: logoData, signature: signatureData }, items, ritems, total, paid }
}

async function createThumbnailForSnapshot(docType){
  const docEl = docType === 'receipt' ? q('receipt') : q('invoice')
  const canvas = await renderElementHighRes(docEl, 150)
  const TH_W = 220
  const scale = TH_W / canvas.width
  const thumb = document.createElement('canvas'); thumb.width = TH_W; thumb.height = Math.round(canvas.height * scale)
  const ctx = thumb.getContext('2d'); ctx.drawImage(canvas,0,0,thumb.width,thumb.height)
  return thumb.toDataURL('image/png')
}

/* History render */
function renderHistoryList(){
  const list = loadHistory(); const container = q('historyList'); container.innerHTML = ''
  if(list.length === 0){ container.innerHTML = '<div class="hint">No saved history yet.</div>'; return }
  list.forEach(item=>{
    const div = document.createElement('div'); div.className='history-item'
    div.innerHTML = `<div><strong>${item.type.toUpperCase()}</strong> No:${item.meta.docNo} • ${new Date(item.createdAt).toLocaleString()}</div>
      <div><button class="btn load" data-id="${item.id}">Load</button> <button class="btn download" data-id="${item.id}">Download</button> <button class="btn subtle delete" data-id="${item.id}">Delete</button></div>`
    container.appendChild(div)
  })
  container.querySelectorAll('button.load').forEach(b=> b.onclick = ()=> loadHistoryItem(Number(b.dataset.id)))
  container.querySelectorAll('button.delete').forEach(b=> b.onclick = ()=> { const id=Number(b.dataset.id); const arr=loadHistory().filter(i=>i.id!==id); saveHistory(arr) })
  container.querySelectorAll('button.download').forEach(b=> b.onclick = async ()=>{
    const id = Number(b.dataset.id); const item = loadHistory().find(i=>i.id===id); if(!item) return
    applySnapshotToUI(item); await new Promise(r=>setTimeout(r,250))
    const docEl = item.type === 'receipt' ? q('receipt') : q('invoice'); const canvas = await renderElementHighRes(docEl, Number(q('exportDPI').value))
    canvas.toBlob(async (blob)=> await downloadBlob(blob, `${item.type}_${item.meta.docNo || item.id}.png`), 'image/png')
  })
}

function loadHistoryItem(id){ const item = loadHistory().find(i=>i.id===id); if(!item) return; applySnapshotToUI(item) }
function applySnapshotToUI(snapshot){
  q('companyName').value = snapshot.meta.companyName || ''
  q('docNo').value = snapshot.meta.docNo || ''
  q('billTo').value = snapshot.meta.billTo || ''
  if(snapshot.images && snapshot.images.signature){ if(q('signatureImg')){ q('signatureImg').src = snapshot.images.signature; q('signatureImg').style.display='block' }; if(q('signatureImgR')){ q('signatureImgR').src = snapshot.images.signature; q('signatureImgR').style.display='block' } }
  if(snapshot.images && snapshot.images.logo){ if(q('headerLogoImg')) q('headerLogoImg').src = snapshot.images.logo; if(q('headerLogoImgR')) q('headerLogoImgR').src = snapshot.images.logo }
  invClear(); snapshot.items.forEach(it => invAddRow(it.desc,it.qty,it.price))
  recClear(); snapshot.ritems.forEach(it => recAddRow(it.desc,it.qty,it.unit))
  q('amountPaid').value = snapshot.paid || 0
  if(snapshot.type==='receipt') showReceipt(); else showInvoice()
  syncAll()
}

/* Sales */
function renderSales(){
  const sales = loadSales()
  const summary = q('salesSummary'); if(summary) summary.innerHTML = `<div><strong>Total Entries:</strong> ${sales.length}</div><div><strong>Total Amount:</strong> ${formatNumber(sales.reduce((s,x)=> s + (Number(x.total)||0),0))} UGX</div>`
  const byDay = {}
  sales.forEach(s => { const day = new Date(s.createdAt).toLocaleDateString(); (byDay[day]=byDay[day]||[]).push(s) })
  const container = q('salesByDay'); if(!container) return; container.innerHTML = ''
  Object.keys(byDay).sort((a,b)=> new Date(b) - new Date(a)).forEach(day=>{
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

/* Utilities */
function setText(id, text){ if(q(id)) q(id).innerHTML = text }
function formatNumber(n){ return Intl.NumberFormat().format(Number(n||0)) }

/* Service Worker register */
function registerServiceWorker(){
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('service-worker.js').then(()=> console.log('SW registered')).catch(e=> console.warn('SW failed', e))
  }
}