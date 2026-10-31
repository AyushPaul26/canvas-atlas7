// Hand-authored PDF fixtures: no external files, personal documents, or network.
export function syntheticPdf(pages: string[], encrypted = false, illustratedPages: number[] = []): Uint8Array {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`];
  for (const [index, text] of pages.entries()) {
    const content = (text ? `BT /F1 12 Tf 30 100 Td (${text.replace(/[\\()]/g, '\\$&')}) Tj ET` : '') + (illustratedPages.includes(index + 1) ? '\n0.2 0.3 0.8 rg 30 20 60 25 re f 0 G 2 w 30 32 m 130 32 l S' : '');
    const pageIndex = objects.length + 1;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 150] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents ${pageIndex + 1} 0 R >>`, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }
  if (encrypted) objects.push('<< /Filter /Standard /V 1 /R 2 /Length 40 /O <' + '00'.repeat(32) + '> /U <' + '00'.repeat(32) + '> /P -4 >>');
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const start = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${encrypted ? ` /Encrypt ${objects.length} 0 R /ID [<00000000000000000000000000000000><00000000000000000000000000000000>]` : ''} >>\nstartxref\n${start}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}
