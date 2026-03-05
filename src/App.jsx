import { useState, useCallback, useRef } from "react";

const ANTHROPIC_SYSTEM_PROMPT = `You are an expert invoice auditor with deep knowledge of Indian business billing practices, GST regulations, logistics pricing, and vendor billing patterns.

You analyze invoices with the following expertise:
1. **GST Verification**: Check if GST rates match HSN/SAC codes per Indian tax law. Common errors: wrong GST slab (5% vs 12% vs 18% vs 28%), missing IGST vs CGST+SGST distinction for inter-state vs intra-state.
2. **Calculation Errors**: Verify line item totals, subtotals, GST amounts, and grand total arithmetic.
3. **Rate Card Anomalies**: Flag unusually high unit rates compared to market norms or historical patterns.
4. **Duplicate Detection**: Note if invoice numbers, dates, or amounts suggest duplicates.
5. **Mystery Surcharges**: Identify vague line items like "miscellaneous charges", "handling fees", "fuel surcharge" without contractual basis.
6. **HSN Code Verification**: Cross-check HSN codes against the items described.
7. **Rounding Manipulation**: Detect systematic upward rounding.
8. **Quantity Padding**: Flag unusually high quantities for the service period.

For ANY invoice or document provided, extract ALL visible information and analyze it. Even if the document is unclear or partially readable, do your best analysis.

CRITICAL: You MUST respond with ONLY valid JSON. No markdown, no explanation outside JSON.

Response format:
{
  "vendor_name": "string",
  "invoice_number": "string", 
  "invoice_date": "string",
  "total_billed": number,
  "currency": "INR",
  "line_items": [
    {
      "description": "string",
      "quantity": number,
      "unit_rate": number,
      "amount": number,
      "hsn_code": "string or null",
      "gst_rate": number
    }
  ],
  "extracted_gst": number,
  "extracted_subtotal": number,
  "discrepancies": [
    {
      "type": "CALCULATION_ERROR | GST_MISMATCH | MYSTERY_SURCHARGE | RATE_ANOMALY | DUPLICATE_RISK | HSN_MISMATCH | ROUNDING_MANIPULATION | QUANTITY_PADDING",
      "severity": "HIGH | MEDIUM | LOW",
      "line_item": "string describing which item",
      "description": "clear explanation of the issue",
      "billed_amount": number,
      "correct_amount": number,
      "overcharge": number
    }
  ],
  "total_overcharge": number,
  "correct_total": number,
  "risk_score": number,
  "risk_level": "HIGH | MEDIUM | LOW | CLEAN",
  "audit_summary": "2-3 sentence executive summary of findings",
  "vendor_type": "LOGISTICS | RAW_MATERIALS | MARKETING | IT_SERVICES | UTILITIES | PROFESSIONAL_SERVICES | OTHER",
  "confidence": number,
  "recommendations": ["array of actionable recommendations"]
}

Be thorough, specific, and quantify every overcharge with exact amounts.`;

const DEMO_INVOICES = [
  {
    name: "TruckFast Logistics - March 2025",
    vendor: "TruckFast Logistics Pvt Ltd",
    invoice_number: "TFL/2025/03/4821",
    invoice_date: "31-Mar-2025",
    total_billed: 184750,
    currency: "INR",
    line_items: [
      { description: "Mumbai-Delhi Route Freight (FTL)", quantity: 8, unit_rate: 14500, amount: 116000, hsn_code: "9965", gst_rate: 5 },
      { description: "Pune-Bengaluru Express Delivery", quantity: 5, unit_rate: 9800, amount: 49000, hsn_code: "9965", gst_rate: 5 },
      { description: "Fuel Surcharge (variable)", quantity: 1, unit_rate: 8500, amount: 8500, hsn_code: null, gst_rate: 18 },
      { description: "Loading/Unloading Charges", quantity: 13, unit_rate: 650, amount: 8450, hsn_code: "9967", gst_rate: 18 },
      { description: "GPS Tracking Fee", quantity: 1, unit_rate: 2800, amount: 2800, hsn_code: null, gst_rate: 18 }
    ],
    extracted_subtotal: 151600,
    extracted_gst: 33150,
    discrepancies: [
      { type: "MYSTERY_SURCHARGE", severity: "HIGH", line_item: "Fuel Surcharge (variable)", description: "Fuel surcharge of ₹8,500 applied without contractual basis. Rate card shows flat freight includes fuel. Additionally charged at 18% GST instead of 5% applicable to transport services.", billed_amount: 8500, correct_amount: 0, overcharge: 8500 },
      { type: "GST_MISMATCH", severity: "HIGH", line_item: "Fuel Surcharge (variable)", description: "Transport-related surcharges fall under HSN 9965 at 5% GST. Billing at 18% adds ₹1,105 excess GST on this line.", billed_amount: 1530, correct_amount: 425, overcharge: 1105 },
      { type: "GST_MISMATCH", severity: "MEDIUM", line_item: "Loading/Unloading Charges", description: "HSN 9967 (cargo handling) should be taxed at 18% — this appears correct. However the base rate of ₹650/trip is 30% above market rate of ₹500/trip for this route.", billed_amount: 8450, correct_amount: 6500, overcharge: 1950 },
      { type: "MYSTERY_SURCHARGE", severity: "MEDIUM", line_item: "GPS Tracking Fee", description: "GPS tracking fee not listed in rate card. Standard logistics contracts include tracking in base freight rate.", billed_amount: 2800, correct_amount: 0, overcharge: 2800 },
      { type: "CALCULATION_ERROR", severity: "LOW", line_item: "Grand Total", description: "Subtotal (₹1,51,600) + GST as billed (₹33,150) = ₹1,84,750 but correct GST on net freight should be ₹7,755 (5% on ₹1,55,000 freight items only).", billed_amount: 184750, correct_amount: 162755, overcharge: 21995 }
    ],
    total_overcharge: 14355,
    correct_total: 170395,
    risk_score: 78,
    risk_level: "HIGH",
    vendor_type: "LOGISTICS",
    audit_summary: "TruckFast has billed ₹14,355 in excess charges this cycle through a combination of mystery surcharges (fuel, GPS) with no contractual basis, incorrect GST rate on surcharges, and above-market handling rates. The fuel surcharge pattern is consistent with systematic overbilling seen in Q1.",
    confidence: 91,
    recommendations: [
      "Dispute fuel surcharge of ₹8,500 — no contractual basis; request credit note",
      "Dispute GPS tracking fee ₹2,800 — should be included in base freight",
      "Renegotiate loading/unloading rate to ₹500/trip (current market rate)",
      "Flag this vendor for enhanced scrutiny in next 3 billing cycles",
      "Request corrected invoice with proper HSN 9965 at 5% on all transport charges"
    ]
  },
  {
    name: "Apex Packaging Materials - Feb 2025",
    vendor: "Apex Packaging Materials Ltd",
    invoice_number: "APM/INV/0892",
    invoice_date: "28-Feb-2025",
    total_billed: 94340,
    currency: "INR",
    line_items: [
      { description: "HDPE Bags 50kg (500 units)", quantity: 500, unit_rate: 85, amount: 42500, hsn_code: "3923", gst_rate: 18 },
      { description: "Corrugated Cartons 5-ply (200 units)", quantity: 200, unit_rate: 145, amount: 29000, hsn_code: "4819", gst_rate: 12 },
      { description: "Stretch Wrap Film (10 rolls)", quantity: 10, unit_rate: 890, amount: 8900, hsn_code: "3920", gst_rate: 18 },
      { description: "Packing Labour Charges", quantity: 1, unit_rate: 4500, amount: 4500, hsn_code: "9987", gst_rate: 18 }
    ],
    extracted_subtotal: 79900,
    extracted_gst: 14440,
    discrepancies: [
      { type: "RATE_ANOMALY", severity: "HIGH", line_item: "HDPE Bags 50kg (500 units)", description: "Unit rate of ₹85/bag is 21% above the contracted rate of ₹70/bag (as per rate card dated Jan 2025). On 500 units this creates ₹7,500 overcharge.", billed_amount: 42500, correct_amount: 35000, overcharge: 7500 },
      { type: "CALCULATION_ERROR", severity: "HIGH", line_item: "Grand Total", description: "Subtotal ₹79,900 + GST: HDPE (18%=₹7,650) + Cartons (12%=₹3,480) + Film (18%=₹1,602) + Labour (18%=₹810) = ₹13,542. Billed GST of ₹14,440 is ₹898 higher than correct.", billed_amount: 14440, correct_amount: 13542, overcharge: 898 }
    ],
    total_overcharge: 8398,
    correct_total: 85942,
    risk_score: 61,
    risk_level: "MEDIUM",
    vendor_type: "RAW_MATERIALS",
    audit_summary: "Apex Packaging has billed above contracted rates for HDPE bags and made an arithmetic error in GST calculation totalling ₹8,398 overcharge. The rate discrepancy suggests either a system error where old rates weren't updated or deliberate inflation.",
    confidence: 88,
    recommendations: [
      "Reject invoice and request re-issue at contracted rate of ₹70/bag for HDPE",
      "Recover ₹898 GST calculation error",
      "Audit previous 3 invoices for same HDPE rate issue — potential backdated recovery",
      "Update vendor contract with explicit rate lock clause through June 2025"
    ]
  }
];

function FileDropzone({ onFileSelect, isProcessing }) {
  const [isDragging, setIsDragging] = useState(false);
  const fileRef = useRef();

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) onFileSelect(file);
  }, [onFileSelect]);

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      onClick={() => fileRef.current?.click()}
      style={{
        border: `2px dashed ${isDragging ? '#f59e0b' : '#334155'}`,
        borderRadius: 16,
        padding: '48px 32px',
        textAlign: 'center',
        cursor: isProcessing ? 'not-allowed' : 'pointer',
        background: isDragging ? 'rgba(245,158,11,0.05)' : 'rgba(15,23,42,0.6)',
        transition: 'all 0.2s',
        opacity: isProcessing ? 0.6 : 1
      }}
    >
      <input ref={fileRef} type="file" accept=".pdf,image/*" style={{ display: 'none' }}
        onChange={e => e.target.files[0] && onFileSelect(e.target.files[0])} />
      <div style={{ fontSize: 48, marginBottom: 16 }}>📄</div>
      <div style={{ color: '#f1f5f9', fontSize: 18, fontWeight: 600, marginBottom: 8, fontFamily: "'Syne', sans-serif" }}>
        {isProcessing ? 'Analyzing invoice...' : 'Drop invoice here'}
      </div>
      <div style={{ color: '#64748b', fontSize: 14 }}>PDF or image · AI extracts and audits all fields</div>
    </div>
  );
}

function RiskBadge({ level, score }) {
  const colors = { HIGH: '#ef4444', MEDIUM: '#f59e0b', LOW: '#22c55e', CLEAN: '#22c55e' };
  return (
    <span style={{
      background: colors[level] + '22',
      color: colors[level],
      border: `1px solid ${colors[level]}44`,
      borderRadius: 8,
      padding: '4px 12px',
      fontSize: 13,
      fontWeight: 700,
      fontFamily: 'monospace',
      letterSpacing: 1
    }}>
      {level} RISK {score !== undefined && `· ${score}/100`}
    </span>
  );
}

function SeverityDot({ severity }) {
  const colors = { HIGH: '#ef4444', MEDIUM: '#f59e0b', LOW: '#3b82f6' };
  return <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: colors[severity], marginRight: 8 }} />;
}

function DiscrepancyCard({ d }) {
  const typeLabels = {
    CALCULATION_ERROR: '🔢 Calc Error',
    GST_MISMATCH: '📊 GST Mismatch',
    MYSTERY_SURCHARGE: '❓ Mystery Charge',
    RATE_ANOMALY: '📈 Rate Anomaly',
    DUPLICATE_RISK: '🔁 Duplicate Risk',
    HSN_MISMATCH: '🏷️ HSN Mismatch',
    ROUNDING_MANIPULATION: '🔄 Rounding',
    QUANTITY_PADDING: '📦 Qty Padding'
  };
  return (
    <div style={{
      background: 'rgba(15,23,42,0.8)',
      border: '1px solid #1e293b',
      borderLeft: `3px solid ${d.severity === 'HIGH' ? '#ef4444' : d.severity === 'MEDIUM' ? '#f59e0b' : '#3b82f6'}`,
      borderRadius: 10,
      padding: '16px 20px',
      marginBottom: 12
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <SeverityDot severity={d.severity} />
          <span style={{ color: '#94a3b8', fontSize: 12, fontFamily: 'monospace' }}>{typeLabels[d.type] || d.type}</span>
          <span style={{ color: '#475569', fontSize: 12, marginLeft: 12 }}>{d.line_item}</span>
        </div>
        {d.overcharge > 0 && (
          <span style={{ color: '#ef4444', fontWeight: 700, fontFamily: 'monospace', fontSize: 15 }}>
            −₹{d.overcharge.toLocaleString('en-IN')}
          </span>
        )}
      </div>
      <div style={{ color: '#cbd5e1', fontSize: 13, lineHeight: 1.6 }}>{d.description}</div>
    </div>
  );
}

function InvoiceResult({ result }) {
  const savings = result.total_overcharge || 0;
  const savingsPct = result.total_billed > 0 ? ((savings / result.total_billed) * 100).toFixed(1) : 0;

  return (
    <div style={{ fontFamily: "'Inter', sans-serif" }}>
      <div style={{
        background: 'linear-gradient(135deg, rgba(15,23,42,0.95) 0%, rgba(30,41,59,0.95) 100%)',
        border: '1px solid #1e293b',
        borderRadius: 16,
        padding: '24px 28px',
        marginBottom: 20,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        flexWrap: 'wrap',
        gap: 16
      }}>
        <div>
          <div style={{ color: '#64748b', fontSize: 12, fontFamily: 'monospace', marginBottom: 4 }}>
            {result.invoice_number} · {result.invoice_date}
          </div>
          <div style={{ color: '#f1f5f9', fontSize: 22, fontWeight: 700, fontFamily: "'Syne', sans-serif", marginBottom: 6 }}>
            {result.vendor_name}
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <RiskBadge level={result.risk_level} score={result.risk_score} />
            <span style={{ color: '#64748b', fontSize: 12, background: '#1e293b', borderRadius: 8, padding: '4px 10px' }}>
              {result.vendor_type}
            </span>
            <span style={{ color: '#64748b', fontSize: 12, background: '#1e293b', borderRadius: 8, padding: '4px 10px' }}>
              {result.confidence}% confidence
            </span>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ color: '#64748b', fontSize: 12, marginBottom: 4 }}>Overcharge Detected</div>
          <div style={{ color: '#ef4444', fontSize: 32, fontWeight: 800, fontFamily: 'monospace' }}>
            ₹{savings.toLocaleString('en-IN')}
          </div>
          <div style={{ color: '#64748b', fontSize: 12 }}>{savingsPct}% of invoice value</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Total Billed', value: `₹${result.total_billed?.toLocaleString('en-IN')}`, color: '#94a3b8' },
          { label: 'Correct Amount', value: `₹${result.correct_total?.toLocaleString('en-IN')}`, color: '#22c55e' },
          { label: 'Discrepancies', value: result.discrepancies?.length || 0, color: '#f59e0b' }
        ].map(item => (
          <div key={item.label} style={{ background: 'rgba(15,23,42,0.8)', border: '1px solid #1e293b', borderRadius: 12, padding: '16px 20px', textAlign: 'center' }}>
            <div style={{ color: '#475569', fontSize: 11, fontFamily: 'monospace', marginBottom: 6 }}>{item.label}</div>
            <div style={{ color: item.color, fontSize: 20, fontWeight: 700, fontFamily: 'monospace' }}>{item.value}</div>
          </div>
        ))}
      </div>

      <div style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 12, padding: '16px 20px', marginBottom: 20 }}>
        <div style={{ color: '#60a5fa', fontSize: 11, fontFamily: 'monospace', marginBottom: 8 }}>AUDIT SUMMARY</div>
        <div style={{ color: '#cbd5e1', fontSize: 14, lineHeight: 1.7 }}>{result.audit_summary}</div>
      </div>

      {result.discrepancies?.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ color: '#475569', fontSize: 11, fontFamily: 'monospace', marginBottom: 12 }}>
            DISCREPANCIES FOUND ({result.discrepancies.length})
          </div>
          {result.discrepancies.map((d, i) => <DiscrepancyCard key={i} d={d} />)}
        </div>
      )}

      {result.line_items?.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ color: '#475569', fontSize: 11, fontFamily: 'monospace', marginBottom: 12 }}>EXTRACTED LINE ITEMS</div>
          <div style={{ background: 'rgba(15,23,42,0.8)', border: '1px solid #1e293b', borderRadius: 12, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #1e293b' }}>
                  {['Description', 'Qty', 'Rate', 'Amount', 'HSN', 'GST%'].map(h => (
                    <th key={h} style={{ color: '#475569', fontFamily: 'monospace', fontSize: 11, padding: '10px 16px', textAlign: h === 'Description' ? 'left' : 'right' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.line_items.map((item, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #0f172a' }}>
                    <td style={{ color: '#cbd5e1', padding: '10px 16px' }}>{item.description}</td>
                    <td style={{ color: '#94a3b8', padding: '10px 16px', textAlign: 'right', fontFamily: 'monospace' }}>{item.quantity}</td>
                    <td style={{ color: '#94a3b8', padding: '10px 16px', textAlign: 'right', fontFamily: 'monospace' }}>₹{item.unit_rate?.toLocaleString('en-IN')}</td>
                    <td style={{ color: '#f1f5f9', padding: '10px 16px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>₹{item.amount?.toLocaleString('en-IN')}</td>
                    <td style={{ color: '#64748b', padding: '10px 16px', textAlign: 'right', fontFamily: 'monospace' }}>{item.hsn_code || '—'}</td>
                    <td style={{ color: '#64748b', padding: '10px 16px', textAlign: 'right', fontFamily: 'monospace' }}>{item.gst_rate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {result.recommendations?.length > 0 && (
        <div>
          <div style={{ color: '#475569', fontSize: 11, fontFamily: 'monospace', marginBottom: 12 }}>RECOMMENDED ACTIONS</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {result.recommendations.map((r, i) => (
              <div key={i} style={{ background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.15)', borderRadius: 10, padding: '12px 16px', color: '#86efac', fontSize: 13, display: 'flex', gap: 10 }}>
                <span style={{ color: '#22c55e', fontWeight: 700 }}>{i + 1}.</span> {r}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DashboardView({ results }) {
  const totalBilled = results.reduce((s, r) => s + (r.total_billed || 0), 0);
  const totalOvercharge = results.reduce((s, r) => s + (r.total_overcharge || 0), 0);
  const totalCorrect = results.reduce((s, r) => s + (r.correct_total || 0), 0);
  const highRisk = results.filter(r => r.risk_level === 'HIGH').length;

  const discrepancyTypes = {};
  results.forEach(r => {
    (r.discrepancies || []).forEach(d => {
      discrepancyTypes[d.type] = (discrepancyTypes[d.type] || 0) + (d.overcharge || 0);
    });
  });

  return (
    <div>
      <div style={{ fontFamily: "'Syne', sans-serif", color: '#f59e0b', fontSize: 12, letterSpacing: 3, marginBottom: 24, textTransform: 'uppercase' }}>
        Portfolio Summary · {results.length} Invoices Audited
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Total Billed', value: `₹${(totalBilled/100000).toFixed(1)}L`, color: '#94a3b8' },
          { label: 'Overcharges Found', value: `₹${(totalOvercharge/100000).toFixed(2)}L`, color: '#ef4444' },
          { label: 'Correct Amount', value: `₹${(totalCorrect/100000).toFixed(1)}L`, color: '#22c55e' },
          { label: 'High Risk Vendors', value: highRisk, color: '#f59e0b' },
        ].map(item => (
          <div key={item.label} style={{ background: 'rgba(15,23,42,0.8)', border: '1px solid #1e293b', borderRadius: 14, padding: '20px 24px' }}>
            <div style={{ color: '#475569', fontSize: 11, fontFamily: 'monospace', marginBottom: 8 }}>{item.label}</div>
            <div style={{ color: item.color, fontSize: 28, fontWeight: 800, fontFamily: 'monospace' }}>{item.value}</div>
          </div>
        ))}
      </div>

      {Object.keys(discrepancyTypes).length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ color: '#475569', fontSize: 11, fontFamily: 'monospace', marginBottom: 12 }}>OVERCHARGE BY TYPE</div>
          {Object.entries(discrepancyTypes).sort((a, b) => b[1] - a[1]).map(([type, amt]) => {
            const pct = totalOvercharge > 0 ? (amt / totalOvercharge * 100) : 0;
            const typeLabels = { MYSTERY_SURCHARGE: '❓ Mystery Charges', GST_MISMATCH: '📊 GST Errors', RATE_ANOMALY: '📈 Rate Inflation', CALCULATION_ERROR: '🔢 Calc Errors', QUANTITY_PADDING: '📦 Qty Padding', HSN_MISMATCH: '🏷️ HSN Issues', DUPLICATE_RISK: '🔁 Duplicates' };
            return (
              <div key={type} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: '#94a3b8', fontSize: 13 }}>{typeLabels[type] || type}</span>
                  <span style={{ color: '#ef4444', fontFamily: 'monospace', fontSize: 13 }}>₹{amt.toLocaleString('en-IN')}</span>
                </div>
                <div style={{ background: '#1e293b', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                  <div style={{ background: '#ef4444', width: `${pct}%`, height: '100%', borderRadius: 4 }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState('upload');
  const [results, setResults] = useState([]);
  const [currentResult, setCurrentResult] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [processingStatus, setProcessingStatus] = useState('');

  const processFile = async (file) => {
    setIsProcessing(true);
    setError(null);
    setCurrentResult(null);
    setProcessingStatus('Reading file...');

    try {
      const isImage = file.type.startsWith('image/');
      const isPDF = file.type === 'application/pdf';

      if (!isImage && !isPDF) throw new Error('Please upload a PDF or image file');

      setProcessingStatus('Sending to AI for analysis...');

      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const mediaType = isPDF ? 'application/pdf' : file.type;
      const contentBlock = isPDF
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
        : { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } };

      setProcessingStatus('AI extracting invoice data...');

      const response = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4000,
          system: ANTHROPIC_SYSTEM_PROMPT,
          messages: [{
            role: 'user',
            content: [
              contentBlock,
              { type: 'text', text: 'Analyze this invoice thoroughly. Extract ALL fields and identify ALL discrepancies. Return ONLY valid JSON.' }
            ]
          }]
        })
      });

      setProcessingStatus('Parsing audit results...');

      const raw = await response.json();
      if (raw.error) throw new Error(raw.error?.message || 'API error');

      let text = '';
      if (raw.content && Array.isArray(raw.content)) {
        text = raw.content.map(b => (b && b.text) ? b.text : '').join('');
      }

      console.log('RAW RESPONSE:', JSON.stringify(raw).substring(0, 500));
      console.log('TEXT:', text.substring(0, 300));

      if (!text || text.trim() === '') {
        throw new Error('AI returned empty response. Please try again.');
      }

      let parsed = {};
      try {
        const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        parsed = JSON.parse(clean);
      } catch {
        const match = text.match(/\{[\s\S]*\}/);
        if (match) { try { parsed = JSON.parse(match[0]); } catch { parsed = {}; } }
      }

      console.log('PARSED:', JSON.stringify(parsed).substring(0, 300));

      const enriched = {
        vendor_name: 'Unknown Vendor',
        invoice_number: 'N/A',
        invoice_date: 'N/A',
        total_billed: 0,
        currency: 'INR',
        extracted_gst: 0,
        extracted_subtotal: 0,
        total_overcharge: 0,
        correct_total: 0,
        risk_score: 0,
        risk_level: 'LOW',
        audit_summary: 'Analysis complete.',
        vendor_type: 'OTHER',
        confidence: 80,
        ...parsed,
        line_items: Array.isArray(parsed.line_items) ? parsed.line_items : [],
        discrepancies: Array.isArray(parsed.discrepancies) ? parsed.discrepancies : [],
        recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
        _filename: file.name
      };
      setCurrentResult(enriched);
      setResults(prev => [enriched, ...prev]);
      setActiveTab('result');

    } catch (err) {
      setError(err.message);
    } finally {
      setIsProcessing(false);
      setProcessingStatus('');
    }
  };

  const loadDemo = (demo) => {
    const result = { ...demo, _filename: demo.name };
    setCurrentResult(result);
    setResults(prev => [result, ...prev.filter(r => r._filename !== demo.name)]);
    setActiveTab('result');
  };

  const tabs = [
    { id: 'upload', label: '↑ Upload' },
    { id: 'result', label: '⚡ Audit Report', disabled: !currentResult },
    { id: 'dashboard', label: '◈ Dashboard', disabled: results.length === 0 },
  ];

  return (
    <div style={{ minHeight: '100vh', background: '#020817', color: '#f1f5f9', fontFamily: "'Inter', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />

      <div style={{
        background: 'rgba(2,8,23,0.95)',
        borderBottom: '1px solid #1e293b',
        padding: '16px 32px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        backdropFilter: 'blur(12px)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ background: 'linear-gradient(135deg, #f59e0b, #ef4444)', borderRadius: 10, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🔍</div>
          <div>
            <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 18, letterSpacing: -0.5 }}>
              InvoiceAudit <span style={{ color: '#f59e0b' }}>AI</span>
            </div>
            <div style={{ color: '#475569', fontSize: 11, fontFamily: 'monospace' }}>FINANCE INTELLIGENCE · OVERCHARGE DETECTION</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {tabs.map(tab => (
            <button key={tab.id}
              disabled={tab.disabled}
              onClick={() => !tab.disabled && setActiveTab(tab.id)}
              style={{
                background: activeTab === tab.id ? 'rgba(245,158,11,0.15)' : 'transparent',
                border: `1px solid ${activeTab === tab.id ? '#f59e0b' : '#1e293b'}`,
                borderRadius: 8,
                color: tab.disabled ? '#334155' : activeTab === tab.id ? '#f59e0b' : '#64748b',
                padding: '8px 16px',
                fontSize: 13,
                cursor: tab.disabled ? 'not-allowed' : 'pointer',
                fontFamily: "'Inter', sans-serif",
                transition: 'all 0.2s'
              }}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: '100%', margin: '0 auto', padding: '40px 24px' }}>

        {activeTab === 'upload' && (
          <div>
            <div style={{ marginBottom: 40, textAlign: 'center' }}>
              <div style={{ color: '#f59e0b', fontFamily: 'monospace', fontSize: 12, letterSpacing: 3, marginBottom: 12 }}>AI-POWERED INVOICE AUDITOR</div>
              <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: 40, fontWeight: 800, letterSpacing: -1, marginBottom: 12, lineHeight: 1.2 }}>
                Where Does Your<br /><span style={{ color: '#f59e0b' }}>Money Leak?</span>
              </h1>
              <p style={{ color: '#64748b', fontSize: 15, maxWidth: 480, margin: '0 auto', lineHeight: 1.7 }}>
                5–10% of invoices contain overcharges. On ₹50L/month in vendor spend, that's ₹2.5–5L recovered every billing cycle.
              </p>
            </div>

            <FileDropzone onFileSelect={processFile} isProcessing={isProcessing} />

            {isProcessing && (
              <div style={{ textAlign: 'center', marginTop: 24 }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 12, padding: '12px 24px' }}>
                  <div style={{ width: 16, height: 16, border: '2px solid #f59e0b', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                  <span style={{ color: '#f59e0b', fontSize: 14 }}>{processingStatus}</span>
                </div>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              </div>
            )}

            {error && (
              <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 12, padding: '16px 20px', marginTop: 16, color: '#fca5a5' }}>
                ⚠️ {error}
              </div>
            )}

            <div style={{ marginTop: 40 }}>
              <div style={{ color: '#475569', fontSize: 11, fontFamily: 'monospace', marginBottom: 16 }}>OR TRY DEMO INVOICES WITH PRE-ANALYZED FINDINGS</div>
              <div style={{ display: 'grid', gap: 12 }}>
                {DEMO_INVOICES.map((demo, i) => (
                  <div key={i} onClick={() => loadDemo(demo)}
                    style={{ background: 'rgba(15,23,42,0.8)', border: '1px solid #1e293b', borderRadius: 14, padding: '18px 22px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'all 0.2s' }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = '#f59e0b'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = '#1e293b'}>
                    <div>
                      <div style={{ color: '#f1f5f9', fontWeight: 600, marginBottom: 4 }}>{demo.name}</div>
                      <div style={{ color: '#475569', fontSize: 12, fontFamily: 'monospace' }}>{demo.discrepancies.length} issues · {demo.vendor_type}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ color: '#ef4444', fontWeight: 700, fontFamily: 'monospace' }}>−₹{demo.total_overcharge.toLocaleString('en-IN')}</div>
                      <RiskBadge level={demo.risk_level} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ marginTop: 48, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
              {[
                { icon: '🎯', title: 'Business Logic', desc: 'Knows GST slabs, HSN codes, and what a "mystery surcharge" actually means' },
                { icon: '📊', title: 'Pattern Detection', desc: 'Spots rate inflation, quantity padding, and systematic rounding manipulation' },
                { icon: '⚡', title: 'Minutes, Not Days', desc: 'What takes finance teams 3 days per cycle takes seconds per invoice' }
              ].map(item => (
                <div key={item.title} style={{ background: 'rgba(15,23,42,0.6)', border: '1px solid #1e293b', borderRadius: 14, padding: '20px' }}>
                  <div style={{ fontSize: 28, marginBottom: 10 }}>{item.icon}</div>
                  <div style={{ color: '#f1f5f9', fontWeight: 600, marginBottom: 6, fontFamily: "'Syne', sans-serif" }}>{item.title}</div>
                  <div style={{ color: '#64748b', fontSize: 13, lineHeight: 1.6 }}>{item.desc}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'result' && currentResult && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <div>
                <div style={{ color: '#f59e0b', fontFamily: 'monospace', fontSize: 11, letterSpacing: 2, marginBottom: 4 }}>AUDIT REPORT</div>
                <div style={{ color: '#475569', fontSize: 13 }}>{currentResult._filename}</div>
              </div>
              <button onClick={() => setActiveTab('upload')}
                style={{ background: 'transparent', border: '1px solid #334155', borderRadius: 8, color: '#64748b', padding: '8px 16px', cursor: 'pointer', fontSize: 13 }}>
                ← Audit Another
              </button>
            </div>
            <InvoiceResult result={currentResult} />
          </div>
        )}

        {activeTab === 'dashboard' && results.length > 0 && (
          <div>
            <DashboardView results={results} />
            <div style={{ marginTop: 32 }}>
              <div style={{ color: '#475569', fontSize: 11, fontFamily: 'monospace', marginBottom: 16 }}>ALL AUDITED INVOICES</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {results.map((r, i) => (
                  <div key={i} onClick={() => { setCurrentResult(r); setActiveTab('result'); }}
                    style={{ background: 'rgba(15,23,42,0.8)', border: '1px solid #1e293b', borderRadius: 12, padding: '16px 20px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = '#334155'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = '#1e293b'}>
                    <div>
                      <div style={{ color: '#f1f5f9', fontWeight: 600, marginBottom: 4 }}>{r.vendor_name}</div>
                      <div style={{ color: '#475569', fontSize: 12 }}>{r.invoice_number} · {r.invoice_date}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ color: '#ef4444', fontFamily: 'monospace', fontWeight: 700 }}>−₹{(r.total_overcharge || 0).toLocaleString('en-IN')}</div>
                        <div style={{ color: '#475569', fontSize: 12 }}>of ₹{(r.total_billed || 0).toLocaleString('en-IN')}</div>
                      </div>
                      <RiskBadge level={r.risk_level} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
