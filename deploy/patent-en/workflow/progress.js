const phases = [
  { title: 'Confidential assessment', note: 'Undertaking, consultation and report', icon: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3m-4 5v2"/>' },
  { title: 'Invention selection', note: 'Record your final technical direction', icon: '<path d="M8 15c0-2-3-3-3-7a7 7 0 0 1 14 0c0 4-3 5-3 7v2H8zm2 5h4m-3 2h2"/>' },
  { title: 'Agreement and drafting', note: 'Sign, prepare and approve the package', icon: '<path d="M6 2h8l4 4v16H6zm8 0v5h4M9 12h6m-6 4h6"/>' },
  { title: 'Filing and ISA', note: 'Official processing and agreed response', icon: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c4 5 4 13 0 18m0-18c-4 5-4 13 0 18"/>' },
  { title: 'Completion', note: 'Official notice and final balance', icon: '<path d="M5 3h14v18l-3-2-4 2-4-2-3 2zm4 10 2 2 4-5"/>' },
];
const stageIndex = new Map([
  ...['consultation_payment','consultation_requested','report_payment','report_work','report_ready'].map(s=>[s,0]),
  ...['idea_selection','idea_review','declined','awaiting_quote'].map(s=>[s,1]),
  ...['quote_ready','agreement_review','pct_deposit','pct_intake','pct_start_pending','pct_drafting','pct_draft_review','pct_draft_revision','pct_finalizing','pct_package_ready','pct_filing_consent','pct_authorized'].map(s=>[s,2]),
  ...['pct_submitting','isa_wait','pct_response','publication_wait'].map(s=>[s,3]),
  ...['completion_due','completed','closed_by_agreement'].map(s=>[s,4]),
]);
export function progress(stage) {
  const current = stageIndex.get(stage) ?? 0;
  const final = stage === 'completed', closed = stage === 'closed_by_agreement';
  return `<section class="progress-panel" aria-labelledby="route-title">
    <div><span class="eyebrow">CASE ROADMAP</span><h3 id="route-title">From confidential idea to filing</h3></div>
    <ol class="case-roadmap">${phases.map((p,i)=>{
      const state = closed ? (i===4?'current':'later') : final || i<current ? 'done' : i===current ? 'current' : 'later';
      return `<li class="${state}"${state==='current'?' aria-current="step"':''}>
        <span class="route-node" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round">${p.icon}</svg></span>
        <span class="route-copy"><small>${i+1} · ${state==='current'?'Current':state==='done'?'Done':'Upcoming'}</small><strong>${p.title}</strong><span>${p.note}</span></span>
      </li>`;
    }).join('')}</ol></section>`;
}
