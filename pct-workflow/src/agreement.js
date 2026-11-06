import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { checkedLegalBytes } from './files.js';
import { ensure } from './state.js';

const escape = value => String(value).replace(/[<>&"']/g,ch=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[ch]));
const unescape = value => value.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, entity => {
  const name=entity.slice(1,-1);
  if (name[0]==='#') {
    const cp=name[1].toLowerCase()==='x'?parseInt(name.slice(2),16):Number(name.slice(1));
    return Number.isInteger(cp) && cp>=0 && cp<=0x10ffff ? String.fromCodePoint(cp) : '';
  }
  return { amp:'&',lt:'<',gt:'>',quot:'"',apos:"'" }[name] || '';
});
const usd = cents => (cents / 100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const date = t => new Date(t*1000).toISOString().slice(0,10);
const tokens = ['CASE_REF','QUOTE_ID','ISSUE_DATE','PCT_TOTAL','PCT_START','PCT_READY','PCT_COMPLETION',
  'CLIENT_NAME','CLIENT_ROLE','CLIENT_ADDRESS','CLIENT_EMAIL','CLIENT_REGISTRATION','CLIENT_SIGNATURE','CLIENT_DATE'];

async function template(env, doc) {
  const entries = unzipSync(await checkedLegalBytes(env, doc));
  const xml = entries['word/document.xml'] && strFromU8(entries['word/document.xml']);
  ensure(xml && tokens.every(t => xml.includes('{{'+t+'}}')),
    'The private contract template is not valid for case signing.', 503, 'agreement_unavailable');
  return { entries, xml };
}

export async function verifyAgreementTemplate(env, doc) { await template(env,doc); }

function personalize(xml, row, signed) {
  const q=row.state.quote, fields = signed?.party;
  const values = {
    CASE_REF:row.public_ref, QUOTE_ID:q.id, ISSUE_DATE:date(q.offered_at), PCT_TOTAL:usd(q.total),
    PCT_START:usd(q.start), PCT_READY:usd(q.ready), PCT_COMPLETION:usd(q.completion),
    CLIENT_NAME:fields?.name || '____________________________________',
    CLIENT_ROLE:fields?.role || '____________________________________',
    CLIENT_ADDRESS:fields?.address || '____________________________________',
    CLIENT_EMAIL:fields?.email || '____________________________________',
    CLIENT_REGISTRATION:fields?.registration || (fields ? 'Not provided' : '____________________________________'),
    CLIENT_SIGNATURE:signed?.signer || '____________________________________',
    CLIENT_DATE:signed ? date(signed.accepted_at) : '____________________',
  };
  for (const t of tokens) xml=xml.replaceAll('{{'+t+'}}',escape(values[t]));
  return xml;
}

export async function caseAgreementDocx(env, row, signed = null) {
  const { entries, xml }=await template(env,row.state.quote.agreement);
  entries['word/document.xml']=strToU8(personalize(xml,row,signed));
  return zipSync(entries,{level:6,mtime:new Date('2000-01-01T00:00:00Z')});
}

export async function agreementSections(env,row) {
  const {xml}=await template(env,row.state.quote.agreement);
  const body=personalize(xml,row,null).split('<w:body>')[1]?.split('</w:body>')[0] || '';
  const txt = block => [...block.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:br\s*\/>/g)]
    .map(m=>m[1]===undefined?'\n':unescape(m[1])).join('').trim();
  const result=[];
  for(const match of body.matchAll(/<w:tbl(?:\s[^>]*)?>[\s\S]*?<\/w:tbl>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)){
    const block=match[0];
    if(block.startsWith('<w:tbl')) {
      const rows=[...block.matchAll(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g)]
        .map(tr=>[...tr[0].matchAll(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g)].map(tc=>txt(tc[0])));
      if(rows.length)result.push({type:'table',rows});
    } else {
      const text=txt(block);
      if(text)result.push({type:/w:val="(?:Heading1|Heading2|Title)"/.test(block)?'heading':'paragraph',text});
      if(/<w:drawing[\s>]/.test(block))result.push({type:'provider_signature'});
    }
  }
  ensure(result.length > 5, 'The agreement text could not be displayed.', 503, 'agreement_unavailable');
  return result;
}

export async function providerImage(env, row) {
  const {entries}=await template(env,row.state.quote.agreement);
  const png=entries['word/media/image1.png'];
  ensure(png && png.length<=500000 && png[0]===137 && png[1]===80,
    'The private provider signature is not available.',503,'agreement_unavailable');
  return png;
}
