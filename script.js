// script.js - updated to:
// - use embedded <img> elements for logo & signature (you already set them in the HTML)
// - include QR in exported PNG/PDF by replacing QR canvas with images before html2canvas
// - preview modal works on desktop and mobile
// - PWA install prompt shown on desktop and mobile
// - number inputs have spinners disabled via CSS so users type figures directly
// Save/overwrite as script.js

const q = id => document.getElementById(id)
const HISTORY_KEY = 'bat_media_history_final'
const SALES_KEY = 'bat_media_sales_final'
let lastPreviewDataUrl = null
let deferredInstallPrompt = null

function init(){
  wireUI()
  if(q('invoiceEditorTable').querySelector('tbody').children.length === 0) invAddRow()
  if(q('receiptEditorTable').querySelector('tbody').children.length === 0) recAddRow()
  attachEditors()
  renderHistoryList()
  renderSales()
  syncAll()
  renderQRs()
  window.addEventListener('resize', ()=> { syncAll(); renderQRs() })
}

/* ---------- Wire UI controls ---------- */
function wireUI(){
  // burger (mobile only)
  const burger = q('burger')
  if(burger){
    burger.addEventListener('click', ()=> {
      const open = q('editorPanel').classList.toggle('open')
      toggleOverlay(open)
    })
  }
  const overlay = q('overlay')
  overlay && overlay.addEventListener('click', ()=> { q('editorPanel').classList.remove('open'); toggleOverlay(false) })
  const closeEditor = q('closeEditor')
  closeEditor && closeEditor.addEventListener('click', ()=> { q('editorPanel').classList.remove('open'); toggleOverlay(false) })

  // tabs
  q('tab-invoice') && q('tab-invoice').addEventListener('click', ()=> showInvoice())
  q('tab-receipt') && q('tab-receipt').addEventListener('click', ()=> showReceipt())
  q('tab-sales') && q('tab-sales').addEventListener('click', ()=> showSales())

  // editor actions
  q('invAddRow') && q('invAddRow').addEventListener('click', ()=> { invAddRow(); syncInvoiceEditorToPreview() })
  q('invClear') && q('invClear').addEventListener('click', ()=> { invClear(); syncInvoiceEditorToPreview() })
  q('recAddRow') && q('recAddRow').addEventListener('click', ()=> { recAddRow(); syncReceiptEditorToPreview() })
  q('recClear') && q('recClear').addEventListener('click', ()=> { recClear(); syncReceiptEditorToPreview() })
  q('amountPaid') && q('amountPaid').addEventListener('input', ()=> { syncAll(); renderQRs() })

  // preview & export
  q('previewBtn') && q('previewBtn').addEventListener('click', async ()=>{
    syncAll()
    const docEl = q('invoice').classList.contains('hidden') ? q('receipt') : q('invoice')
    const canvas = await renderElementHighRes(docEl)
    lastPreviewDataUrl = canvas.toDataURL('image/png')
    openPreviewModal(lastPreviewDataUrl)
  })
  q('exportPNG') && q('exportPNG').addEventListener('click', async ()=>{
    syncAll()
    const docEl = q('invoice').classList.contains('hidden') ? q('receipt') : q('invoice')
    const canvas = await renderElementHighRes(docEl)
    canvas.toBlob(async (blob)=> await downloadBlob(blob, (docEl.id === 'invoice' ? 'invoice' : 'receipt') + '.png'), 'image/png')
  })
  q('exportPDF') && q('exportPDF').addEventListener('click', async ()=>{
    syncAll()
    const { jsPDF } = window.jspdf
    const docEl = q('invoice').classList.contains('hidden') ? q('receipt') : q('invoice')
    const canvas = await renderElementHighRes(docEl)
    const imgData = canvas.toDataURL('image/png')
    const pdf = new jsPDF('p','mm','a4')
    const a4mm = { w:210, h:297 }
    const imgHmm = (canvas.height * a4mm.w) / canvas.width
    pdf.addImage(imgData, 'PNG', 0, 0, a4mm.w, imgHmm)
    pdf.save((docEl.id === 'invoice' ? 'invoice' : 'receipt') + '.pdf')
  })

  // modal
  q('closePreview') && q('closePreview').addEventListener('click', closePreviewModal)
  q('modalDownloadPNG') && q('modalDownloadPNG').addEventListener('click', async ()=>{
    if(!lastPreviewDataUrl) return
    const blob = dataURLToBlob(lastPreviewDataUrl)
    await downloadBlob(blob, 'preview.png')
  })
  q('modalDownloadPDF') && q('modalDownloadPDF').addEventListener('click', async ()=>{
    if(!lastPreviewDataUrl) return
    const { jsPDF } = window.jspdf
    const img = lastPreviewDataUrl
    const pdf = new jsPDF('p','mm','a4')
    const imgObj = new Image(); imgObj.src = img
    imgObj.onload = () => {
      const imgProps = { width: imgObj.width, height: imgObj.height }
      const a4mm = { w:210, h:297 }
      const imgHmm = (imgProps.height * a4mm.w) / imgProps.width
      pdf.addImage(img, 'PNG', 0, 0, a4mm.w, imgHmm)
      pdf.save('preview.pdf')
    }
  })

  // history save
  q('saveHistory') && q('saveHistory').addEventListener('click', async ()=>{
    const snap = makeSnapshotData()
    snap.thumb = await createThumbnailForSnapshot(snap.type)
    const arr = loadHistory(); arr.unshift(snap); saveHistory(arr)
    addSaleRecord({ id: Date.now(), createdAt: new Date().toISOString(), type: snap.type, docNo: snap.meta.docNo, customer: snap.meta.billTo, total: snap.total || 0, paid: snap.paid || 0 })
    renderHistoryList(); renderSales()
    showToast('Saved to history and sales.')
  })

  // reset
  q('clearAll') && q('clearAll').addEventListener('click', ()=> { if(confirm('Reset all fields?')) location.reload() })

  // install prompt handling - show on desktop too
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredInstallPrompt = e
    const installBtn = q('installBtn')
    if(installBtn){ installBtn.style.display = 'inline-block'; installBtn.onclick = async () => {
      deferredInstallPrompt.prompt()
      const choice = await deferredInstallPrompt.userChoice
      deferredInstallPrompt = null
      installBtn.style.display = 'none'
    } }
  })
}

/* ---------- Overlay ---------- */
function toggleOverlay(show){
  const ov = q('overlay')
  if(show){ ov.classList.add('show'); ov.hidden = false } else { ov.classList.remove('show'); setTimeout(()=> ov.hidden = true, 220) }
}

/* ---------- Editor rows ---------- */
function invAddRow(desc='', qty=1, price=0){
  const tbody = q('invoiceEditorTable').querySelector('tbody')
  const tr = document.createElement('tr')
  tr.innerHTML = `<td><input class="inv-desc" value="${escapeHtml(desc)}" /></td>
    <td><input class="inv-qty" type="number" inputmode="numeric" pattern="[0-9]*" min="0" value="${qty}" /></td>
    <td><input class="inv-price" type="number" inputmode="numeric" pattern="[0-9]*" min="0" value="${price}" /></td>
    <td><button class="inv-remove btn subtle">Remove</button></td>`
  tbody.appendChild(tr)
}
function invClear(){ q('invoiceEditorTable').querySelector('tbody').innerHTML = '' }
function recAddRow(desc='', qty=1, unit=0){
  const tbody = q('receiptEditorTable').querySelector('tbody')
  const tr = document.createElement('tr')
  tr.innerHTML = `<td class="r-no">1</td>
    <td><input class="rec-desc" value="${escapeHtml(desc)}" /></td>
    <td><input class="rec-qty" type="number" inputmode="numeric" pattern="[0-9]*" min="0" value="${qty}" /></td>
    <td><input class="rec-unit" type="number" inputmode="numeric" pattern="[0-9]*" min="0" value="${unit}" /></td>
    <td><button class="rec-remove btn subtle">Remove</button></td>`
  tbody.appendChild(tr)
}
function recClear(){ q('receiptEditorTable').querySelector('tbody').innerHTML = '' }
function escapeHtml(s){ return (s||'').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }

/* ---------- Editor delegation ---------- */
function attachEditors(){
  q('invoiceEditorTable').addEventListener('input', ()=> syncInvoiceEditorToPreview())
  q('invoiceEditorTable').addEventListener('click', (e)=>{
    if(e.target.classList.contains('inv-remove')){ e.target.closest('tr').remove(); syncInvoiceEditorToPreview() }
  })
  q('receiptEditorTable').addEventListener('input', ()=> syncReceiptEditorToPreview())
  q('receiptEditorTable').addEventListener('click', (e)=>{
    if(e.target.classList.contains('rec-remove')){ e.target.closest('tr').remove(); syncReceiptEditorToPreview() }
  })
}

/* ---------- Sync & totals ---------- */
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

  // ensure signature img visibility if user replaced src in HTML
  const sig = q('signatureImg') && q('signatureImg').src
  if(sig && sig.indexOf('INSERT_SIGNATURE_SRC_HERE') === -1) q('signatureImg').style.display = 'block'
  const sigR = q('signatureImgR') && q('signatureImgR').src
  if(sigR && sigR.indexOf('INSERT_SIGNATURE_SRC_HERE') === -1) q('signatureImgR').style.display = 'block'
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

/* ---------- QR generation ---------- */
function renderQRs(){
  try{
    const invData = `INVOICE|No:${q('docNo').value}|Date:${q('docDate').value||new Date().toLocaleDateString()}|Total:${getInvoiceTotal()}`
    new QRious({ element: q('qrInvoice'), value: invData, size: 92 })
    const recData = `RECEIPT|No:${q('docNo').value}|Date:${q('docDate').value||new Date().toLocaleDateString()}|Total:${getReceiptTotal()}`
    new QRious({ element: q('qrReceipt'), value: recData, size: 92 })
  }catch(e){ console.warn('QR render failed', e) }
}

/* ---------- number-to-words ---------- */
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

/* ---------- Preview modal ---------- */
function openPreviewModal(dataUrl){
  q('previewImage').src = dataUrl
  q('previewModal').classList.add('show')
  q('previewModal').ariaHidden = 'false'
}
function closePreviewModal(){
  q('previewModal').classList.remove('show')
  q('previewModal').ariaHidden = 'true'
}

/* ---------- Export: convert QR canvases to images in cloned DOM ---------- */
async function renderElementHighRes(el){
  const canvasEls = Array.from(el.querySelectorAll('canvas'))
  const canvasDataUrls = await Promise.all(canvasEls.map(async c => {
    try { return c.toDataURL('image/png') } catch(e) { return null }
  }))

  const clone = el.cloneNode(true)
  const cloneCanvases = Array.from(clone.querySelectorAll('canvas'))
  cloneCanvases.forEach((c, idx) => {
    const dataUrl = canvasDataUrls[idx]
    const img = document.createElement('img')
    if(dataUrl){ img.src = dataUrl; img.style.width = c.style.width || c.width + 'px'; img.style.height = c.style.height || c.height + 'px' }
    img.className = 'qr-image'
    c.parentNode.replaceChild(img, c)
  })

  clone.style.boxShadow='none'; clone.style.transform='none'; clone.style.margin='0'; clone.style.background='#fff'
  const wrapper = document.createElement('div'); wrapper.style.position='fixed'; wrapper.style.left='-9999px'; wrapper.appendChild(clone); document.body.appendChild(wrapper)
  const A4_PX_WIDTH = 2480
  const elWidth = el.offsetWidth
  const scale = Math.max(1, A4_PX_WIDTH / elWidth)
  const canvas = await html2canvas(clone, { scale, useCORS:true, backgroundColor:'#ffffff' })
  document.body.removeChild(wrapper)
  return canvas
}

async function downloadBlob(blob, filename){ const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url) }
function dataURLToBlob(dataurl){ const arr = dataurl.split(','), mime = arr[0].match(/:(.*?);/)[1], bstr = atob(arr[1]), n = bstr.length, u8arr = new Uint8Array(n); for(let i=0;i<n;i++) u8arr[i]=bstr.charCodeAt(i); return new Blob([u8arr], {type:mime}) }

/* ---------- History & Sales ---------- */
function saveHistory(arr){ localStorage.setItem(HISTORY_KEY, JSON.stringify(arr)); renderHistoryList() }
function loadHistory(){ const raw = localStorage.getItem(HISTORY_KEY); return raw ? JSON.parse(raw) : [] }
function saveSales(arr){ localStorage.setItem(SALES_KEY, JSON.stringify(arr)); renderSales() }
function loadSales(){ const raw = localStorage.getItem(SALES_KEY); return raw ? JSON.parse(raw) : [] }
function addSaleRecord(record){ const arr = loadSales(); arr.unshift(record); saveSales(arr) }

/* ---------- Snapshot maker ---------- */
function makeSnapshotData(){
  const signatureData = (q('signatureImg') && q('signatureImg').src && q('signatureImg').src.indexOf('INSERT_SIGNATURE_SRC_HERE')===-1) ? q('signatureImg').src : ''
  const logoData = (q('headerLogoImg') && q('headerLogoImg').src && q('headerLogoImg').src.indexOf('INSERT_LOGO_SRC_HERE')===-1) ? q('headerLogoImg').src : ''
  const items = Array.from(q('invoiceEditorTable').querySelectorAll('tbody tr')).map(tr => ({
    desc: tr.querySelector('.inv-desc').value || '',
    qty: Number(tr.querySelector('.inv-qty').value||0),
    price: Number(tr.querySelector('.inv-price').value||0)
  }))
  const ritems = Array.from(q('receiptEditorTable').querySelectorAll('tbody tr')).map(tr => ({
    desc: tr.querySelector('.rec-desc').value || '',
    qty: Number(tr.querySelector('.rec-qty').value||0),
    unit: Number(tr.querySelector('.rec-unit').value||0)
  }))
  const total = getInvoiceTotal()
  const paid = Number(q('amountPaid').value || 0)
  const type = q('invoice').classList.contains('hidden') ? 'receipt' : 'invoice'
  return { id: Date.now(), createdAt: new Date().toISOString(), type, meta: { companyName: q('companyName').value, docNo: q('docNo').value, billTo: q('billTo').value }, images: { logo: logoData, signature: signatureData }, items, ritems, total, paid }
}

async function createThumbnailForSnapshot(docType){
  const docEl = docType === 'receipt' ? q('receipt') : q('invoice')
  const canvas = await renderElementHighRes(docEl)
  const TH_W = 220; const scale = TH_W / canvas.width
  const thumb = document.createElement('canvas'); thumb.width = TH_W; thumb.height = Math.round(canvas.height * scale)
  const ctx = thumb.getContext('2d'); ctx.drawImage(canvas,0,0,thumb.width,thumb.height)
  return thumb.toDataURL('image/png')
}

/* ---------- History rendering ---------- */
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
    const docEl = item.type === 'receipt' ? q('receipt') : q('invoice'); const canvas = await renderElementHighRes(docEl)
    canvas.toBlob(async (blob)=> await downloadBlob(blob, `${item.type}_${item.meta.docNo || item.id}.png`), 'image/png')
  })
}

/* ---------- Apply snapshot ---------- */
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

/* ---------- Sales & Customers ---------- */
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

/* ---------- Utilities ---------- */
function setText(id, text){ if(q(id)) q(id).innerHTML = text }
function formatNumber(n){ return Intl.NumberFormat().format(Number(n||0)) }

/* ---------- Start ---------- */
window.addEventListener('load', init)