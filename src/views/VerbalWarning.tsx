import React, { useState, useEffect, useMemo } from 'react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { verbalWarningDb as db } from '@/lib/firebase';
import { ref, get, set, remove } from "firebase/database";

// Prop type definition
interface GSSDisciplinaryFormProps {
  isSuperAdmin?: boolean;   // default false if not provided
}

const GSSDisciplinaryForm: React.FC<GSSDisciplinaryFormProps> = ({ isSuperAdmin = false }) => {
  const [formData, setFormData] = useState({
    ref: '',
    cname: '',
    cpos: '',
    ename: '',
    eid: '',
    otherdesc: '',
  });

  const [selectedOffenses, setSelectedOffenses] = useState<number[]>([]);
  const [selectedLowPerfSub, setSelectedLowPerfSub] = useState<string[]>([]);
  const [showOther, setShowOther] = useState(false);
  const [showCustomPos, setShowCustomPos] = useState(false);
  const [dateTime, setDateTime] = useState({ date: '', time: '' });
  const [copiedSubject, setCopiedSubject] = useState(false);
  const [copiedBody, setCopiedBody] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [savedWarnings, setSavedWarnings] = useState<Array<{ ref: string; dateTime: { date: string; time: string }; cname: string; ename: string; eid: string }>>([]);
  const [selectedLoadRef, setSelectedLoadRef] = useState('');
  const [viewMode, setViewMode] = useState(false);

  const offenses = [
    "Reporting to work late than scheduled.",
    "Not responding Team conversations on time.",
    "Shift ending without any prior notice.",
    "Disobedience/ Arguing to orders from team leaders or supervisors.",
    "Daily data usage misusing & violate non-compliance with service instructions.",
    "Deliberate completion and cancelling computer programs halfway using task manager.",
    "Taking leaves without prior notice",
    "Resting more than the allocated time in the shift.",
    "Deliberate do probe missing tags / masking & Bays, Racks & All task System misused",
    "Continuously low performance. (Accuracy / productivity / cancellation / Tictac & Utilization)"
  ];

  const lowPerfSubOptions = ["Accuracy", "Productivity", "Cancellation", "Tictac", "Utilization"];

  const offenseAdvice: { [key: number]: string } = {
    0: "Please ensure you arrive on time for your scheduled shifts.",
    1: "Please ensure you respond to team conversations promptly.",
    2: "Please ensure you inform your supervisor before leaving at the end of your shift.",
    3: "Please maintain respectful communication with team leaders and supervisors.",
    4: "Please use company data and follow service instructions appropriately.",
    5: "Please do not cancel computer programs or tasks without proper authorization.",
    6: "Please request leave in advance as per company policy.",
    7: "Please adhere to the allocated break times.",
    8: "Please use the task system correctly and avoid deliberate misuse.",
    9: "Please work to improve your performance metrics."
  };

  useEffect(() => {
    const now = new Date();
    setDateTime({
      date: now.toLocaleDateString('en-GB'),
      time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase()
    });
    loadSavedWarnings();
  }, []);

  const loadSavedWarnings = async () => {
    setLoadingRecords(true);
    try {
      const warningsRef = ref(db, 'warnings');
      const snapshot = await get(warningsRef);
      if (snapshot.exists()) {
        const data = snapshot.val();
        const warningsList = Object.entries(data).map(([key, value]: any) => ({
          ref: key,
          dateTime: value.dateTime,
          cname: value.cname,
          ename: value.ename,
          eid: value.eid,
        }));
        warningsList.sort((a, b) => {
          const dateA = new Date(a.dateTime.date + ' ' + a.dateTime.time);
          const dateB = new Date(b.dateTime.date + ' ' + b.dateTime.time);
          return dateB.getTime() - dateA.getTime();
        });
        setSavedWarnings(warningsList);
      } else {
        setSavedWarnings([]);
      }
    } catch (error) {
      console.error("Error loading warnings:", error);
    }
    setLoadingRecords(false);
  };

  const generateUniqueRef = async (): Promise<string> => {
    const year = new Date().getFullYear();
    const counterRef = ref(db, `counters/${year}`);
    try {
      const snapshot = await get(counterRef);
      let currentCount = snapshot.exists() ? snapshot.val() : 0;
      const newCount = currentCount + 1;
      await set(counterRef, newCount);
      return `GSS-${year}-${newCount.toString().padStart(3, '0')}`;
    } catch (error) {
      console.error("Error generating unique ref:", error);
      return `GSS-${year}-${Date.now()}`;
    }
  };

  const saveFormData = async () => {
    setSaving(true);
    try {
      const refNumber = await generateUniqueRef();
      setFormData(prev => ({ ...prev, ref: refNumber }));
      const dataToSave = {
        ...formData,
        ref: refNumber,
        selectedOffenses,
        selectedLowPerfSub,
        showOther,
        dateTime,
        createdAt: new Date().toISOString()
      };
      await set(ref(db, `warnings/${refNumber}`), dataToSave);
      alert(`Warning saved successfully! Reference: ${refNumber}`);
      await loadSavedWarnings();
      resetForm();
    } catch (error) {
      console.error("Error saving data:", error);
      alert("Failed to save. Please try again.");
    }
    setSaving(false);
  };

  const resetForm = () => {
    setFormData({
      ref: '',
      cname: '',
      cpos: '',
      ename: '',
      eid: '',
      otherdesc: '',
    });
    setSelectedOffenses([]);
    setSelectedLowPerfSub([]);
    setShowOther(false);
    setShowCustomPos(false);
    setSelectedLoadRef('');
    setSearchTerm('');
    setViewMode(false);
    const now = new Date();
    setDateTime({
      date: now.toLocaleDateString('en-GB'),
      time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase()
    });
  };

  const loadFormData = async (refNumber: string) => {
    if (!refNumber) return;
    setLoadingRecords(true);
    try {
      const warningRef = ref(db, `warnings/${refNumber}`);
      const snapshot = await get(warningRef);
      if (snapshot.exists()) {
        const data = snapshot.val();
        setFormData({
          ref: data.ref || '',
          cname: data.cname || '',
          cpos: data.cpos || '',
          ename: data.ename || '',
          eid: data.eid || '',
          otherdesc: data.otherdesc || '',
        });
        setSelectedOffenses(data.selectedOffenses || []);
        setSelectedLowPerfSub(data.selectedLowPerfSub || []);
        setShowOther(data.showOther || false);
        if (data.dateTime) {
          setDateTime(data.dateTime);
        }
        if (data.cpos && !["Team Lead", "Assistant Supervisor", "Supervisor"].includes(data.cpos)) {
          setShowCustomPos(true);
        } else {
          setShowCustomPos(false);
        }
        setSelectedLoadRef(refNumber);
        setSearchTerm(refNumber);
        setViewMode(true);
      } else {
        alert("Record not found.");
      }
    } catch (error) {
      console.error("Error loading record:", error);
      alert("Failed to load record.");
    }
    setLoadingRecords(false);
  };

  // 🔒 Modified: only allow deletion if user is Super Admin
  const deleteWarning = async (refNumber: string) => {
    if (!refNumber) return;
    if (!isSuperAdmin) {
      alert("❌ You do not have permission to delete warnings. Only Super Admins can perform this action.");
      return;
    }
    if (!confirm(`Are you sure you want to delete warning ${refNumber}? This action cannot be undone.`)) return;
    setDeleting(true);
    try {
      await remove(ref(db, `warnings/${refNumber}`));
      alert(`Warning ${refNumber} deleted successfully.`);
      await loadSavedWarnings();
      if (selectedLoadRef === refNumber) {
        resetForm();
      }
    } catch (error) {
      console.error("Error deleting warning:", error);
      alert("Failed to delete warning.");
    }
    setDeleting(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    if (viewMode) return;
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const toggleOffense = (index: number) => {
    if (viewMode) return;
    setSelectedOffenses(prev => {
      const newSelection = prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index];
      if (index === 9 && prev.includes(index)) setSelectedLowPerfSub([]);
      return newSelection;
    });
  };

  const toggleLowPerfSub = (sub: string) => {
    if (viewMode) return;
    setSelectedLowPerfSub(prev =>
      prev.includes(sub) ? prev.filter(s => s !== sub) : [...prev, sub]
    );
  };

  const getOffenseAdvice = (): string => {
    if (selectedOffenses.length === 0) return "Please ensure you follow the required guidelines moving forward.";
    const firstOffense = selectedOffenses[0];
    if (firstOffense === 9 && selectedLowPerfSub.length > 0) return "Please work to improve your performance in the specified areas.";
    return offenseAdvice[firstOffense] || "Please correct this behavior immediately.";
  };

  const emailSubject = useMemo(() => {
    const empName = formData.ename || '[Employee Name]';
    const empId = formData.eid || 'GID]';
    return `Discipline Issue - ${empId} - ${empName}`;
  }, [formData.ename, formData.eid]);

  const emailBody = useMemo(() => {
    const empName = formData.ename || '[Warned Employee Name]';
    const counsellor = formData.cname || '[Oral Counsellor Name]';
    let offenseParts: string[] = [];
    selectedOffenses.forEach(i => {
      if (i === 9) {
        if (selectedLowPerfSub.length > 0) offenseParts.push(`continuously low performance (specifically: ${selectedLowPerfSub.join(', ')})`);
        else offenseParts.push(offenses[i]);
      } else {
        offenseParts.push(offenses[i]);
      }
    });
    if (showOther && formData.otherdesc.trim()) offenseParts.push(formData.otherdesc);
    const offenseText = offenseParts.length > 0 ? offenseParts.join('; ') : 'an unspecified offense';
    const advice = getOffenseAdvice();

    const isTeamLead = formData.cpos?.toLowerCase().includes('team lead') || false;
    const warningType = isTeamLead ? 'verbal warning' : '1st warning letter';

    return `Hi ${empName},\n\nThis is to inform you that a ${warningType} is being issued due to your ${offenseText}.\n\nAs the first step, a ${warningType} is being issued. If this issue is repeated, it will be escalated to HR actions through the same email chain.\n\n${advice} Continued issues may lead to further action.\n\nKindly treat this matter seriously and improve your performance.\n\nAlso, please reply to this email with your signature, confirming that you acknowledge the above ${warningType}.\n\nThank you.\n\nBest regards,\n${counsellor}`;
  }, [formData.ename, formData.cname, selectedOffenses, selectedLowPerfSub, showOther, formData.otherdesc, formData.cpos]);

  const copySubjectToClipboard = () => {
    navigator.clipboard.writeText(emailSubject);
    setCopiedSubject(true);
    setTimeout(() => setCopiedSubject(false), 2000);
  };

  const copyBodyToClipboard = () => {
    navigator.clipboard.writeText(emailBody);
    setCopiedBody(true);
    setTimeout(() => setCopiedBody(false), 2000);
  };

  const downloadPDF = async () => {
    setPdfLoading(true);

    const pdfRoot = document.createElement('div');
    pdfRoot.style.cssText = 'position:fixed;top:0;left:0;z-index:-9999;pointer-events:none;';

    const pdfDoc = document.createElement('div');
    pdfDoc.style.cssText = `width:794px;height:auto;padding:45px 57px;box-sizing:border-box;background:#ffffff;position:relative;overflow:visible;display:flex;flex-direction:column;justify-content:space-between;color:#000;font-family:Arial,sans-serif;`;

    const makeCheckbox = (checked: boolean): string => `
      <div style="display:inline-block;width:17px;height:17px;min-width:17px;min-height:17px;overflow:hidden;vertical-align:middle;">
        <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 17 17">
          <rect x="0.75" y="0.75" width="15.5" height="15.5" fill="white" stroke="black" stroke-width="1.5"/>
          ${checked ? `<text x="8.5" y="13" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" font-weight="bold" fill="#ff0000">X</text>` : ''}
        </svg>
      </div>`;

    const dot = `<span style="border-bottom:1px dotted #000;flex-grow:1;margin-left:5px;min-height:18px;display:inline-block;"></span>`;
    const val = (v: string) => v
      ? `<span style="border-bottom:none;padding-left:8px;font-weight:bold;color:#001A54;flex-grow:1;margin-left:5px;">${v}</span>`
      : dot;

    let offenseRowsHtml = '';
    offenses.forEach((text, i) => {
      const sel = selectedOffenses.includes(i);
      if (i === 9) {
        offenseRowsHtml += `
            <tr>
              <td width="25" style="font-size:12.5px;padding:3px 0;">${i + 1}.<\/td>
              <td style="font-size:12.5px;">${text}<\/td>
              <td align="right" width="35" style="vertical-align:middle;">${makeCheckbox(sel)}<\/td>
            <\/tr>`;
        if (sel) {
          lowPerfSubOptions.forEach(sub => {
            offenseRowsHtml += `
                <tr>
                  <td width="25"><\/td>
                  <td style="font-size:12.5px;padding-left:20px;">• ${sub}<\/td>
                  <td align="right" width="35" style="vertical-align:middle;">${makeCheckbox(selectedLowPerfSub.includes(sub))}<\/td>
                <\/tr>`;
          });
        }
      } else {
        offenseRowsHtml += `
            <tr>
              <td width="25" style="font-size:12.5px;padding:3px 0;">${i + 1}.<\/td>
              <td style="font-size:12.5px;">${text}<\/td>
              <td align="right" width="35" style="vertical-align:middle;">${makeCheckbox(sel)}<\/td>
            <\/tr>`;
      }
    });

    pdfDoc.innerHTML = `
      <div>
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <img src="/images/GSS Logo.png" alt="GSS Logo" style="width:160px;height:95px;object-fit:contain;object-position:left center;" />
          <div style="text-align:right;">
            <div style="display:flex;align-items:center;justify-content:flex-end;font-weight:bold;font-size:13px;margin-bottom:8px;">
              Reference Number -
              <div style="border:1.5px solid #000;width:180px;height:28px;margin-left:8px;display:flex;align-items:center;padding-left:8px;font-weight:normal;">${formData.ref}</div>
            </div>
            <div style="font-size:17px;font-weight:bold;">Global System Solutions International (Pvt) Ltd</div>
            <div style="font-size:12px;color:#333;">No .104, Stanley Thilakarathne road, Nugegoda.</div>
          </div>
        </div>

        <p style="font-size:14px;font-weight:500;margin:15px 0 10px 0;">Verbal admonitions of all employees of GSS International Pvt.Ltd.</p>
        <div style="font-weight:bold;text-decoration:underline;font-size:13px;">Oral counsellors,</div>
        <div style="display:flex;margin-top:8px;font-size:13.5px;">
          <div style="width:50%;display:flex;">Name: ${val(formData.cname)}</div>
          <div style="width:50%;display:flex;margin-left:20px;">Position: ${val(formData.cpos)}</div>
        </div>

        <p style="font-size:13.5px;margin:15px 0 8px 0;">Those who are verbally admonished,</p>
        <div style="display:flex;font-size:13.5px;">
          <div style="width:55%;display:flex;">Name: ${val(formData.ename)}</div>
          <div style="width:45%;display:flex;margin-left:20px;">GID: ${val(formData.eid)}</div>
        </div>

        <div style="font-weight:bold;text-decoration:underline;margin-top:15px;font-size:13px;">The nature of the offense and the offense committed:</div>
        <table style="width:100%;border-collapse:collapse;margin-top:5px;">
          <tbody>${offenseRowsHtml}</tbody>
        </table>

        <div style="margin-top:5px;">
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <span style="font-weight:bold;text-decoration:underline;font-size:12.5px;">Performing other disciplinary actions and its nature</span>
            ${makeCheckbox(showOther)}
          </div>
          <div style="border-bottom:1px dotted #000;min-height:20px;margin-top:5px;font-weight:bold;color:#001A54;">${formData.otherdesc}</div>
        </div>

        <div style="display:flex;margin-top:15px;font-size:13.5px;">
          <div style="width:40%;display:flex;">Date of warning: - <span style="margin-left:5px;font-weight:bold;color:#001A54;">${dateTime.date}</span></div>
          <div style="width:40%;display:flex;margin-left:40px;">Time: - <span style="margin-left:5px;font-weight:bold;color:#001A54;">${dateTime.time}</span></div>
        </div>
        <div style="margin-top:25px;display:flex;flex-direction:column;align-items:flex-end;">
          <div style="border-top:1px dotted #000;width:280px;text-align:center;padding-top:4px;font-size:12px;margin-top:30px;">Signature of those who gave the warning</div>
        </div>
      </div>

      <div>
        <div style="font-weight:bold;text-decoration:underline;font-size:13px;">Statement of those who have been warned.</div>
        <p style="text-align:justify;font-size:13px;line-height:1.4;margin:5px 0;">I would like to inform you that I have committed the above disciplinary action and I have been verbally reprimanded for that offense and I refrain from any such disciplinary action, and I agree with any action taken by the management in the event of any further disciplinary action.</p>
        <div style="margin-top:25px;display:flex;flex-direction:column;align-items:flex-end;">
          <div style="border-top:1px dotted #000;width:280px;text-align:center;padding-top:4px;font-size:12px;margin-top:30px;">Signature of those who have been warned</div>
        </div>
        <div style="border:1px solid #000;padding:8px;margin-top:20px;font-size:11.5px;">
          <strong>Should be considered:</strong> - Management reserves the right to take disciplinary action on the nature of the offense and the damages caused by the offense.
        </div>
      </div>
    `;

    pdfRoot.appendChild(pdfDoc);
    document.body.appendChild(pdfRoot);
    await new Promise(r => setTimeout(r, 500));
    const canvas = await html2canvas(pdfDoc, { scale: 3, useCORS: true, allowTaint: false, logging: false, backgroundColor: '#ffffff', scrollX: 0, scrollY: 0, width: pdfDoc.scrollWidth, height: pdfDoc.scrollHeight, windowWidth: pdfDoc.scrollWidth, windowHeight: pdfDoc.scrollHeight });
    document.body.removeChild(pdfRoot);
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pdfWidth;
    const imgHeight = (canvas.height * pdfWidth) / canvas.width;
    let heightLeft = imgHeight;
    let position = 0;
    while (heightLeft > 0) {
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight, undefined, 'FAST');
      heightLeft -= pdfHeight;
      position -= pdfHeight;
      if (heightLeft > 0) pdf.addPage();
    }
    pdf.save(`${formData.eid || 'GID'}-${formData.ename || 'Employee'}.pdf`);
    setPdfLoading(false);
  };

  const DarkCheckBox = ({ checked, gold }: { checked: boolean; gold?: boolean }) => {
    const color = gold ? '#f5c842' : '#00d4ff';
    return (
      <div data-checkbox="true" style={{ display: 'inline-block', width: '15px', height: '15px', minWidth: '15px', minHeight: '15px', overflow: 'hidden', verticalAlign: 'middle' }}>
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 15 15">
          <rect x="0.75" y="0.75" width="13.5" height="13.5" fill={checked ? (gold ? 'rgba(245,200,66,0.15)' : 'rgba(0,180,255,0.12)') : 'rgba(255,255,255,0.03)'} stroke={checked ? color : '#1e3a5a'} strokeWidth="1.2" rx="2"/>
          {checked && <text x="7.5" y="11.5" textAnchor="middle" fontFamily="Arial, sans-serif" fontSize="10" fontWeight="bold" fill={color}>✓</text>}
        </svg>
      </div>
    );
  };

  const CheckBox = ({ checked }: { checked: boolean }) => (
    <div data-checkbox="true" style={{ display: 'inline-block', width: '17px', height: '17px', minWidth: '17px', minHeight: '17px', overflow: 'hidden', verticalAlign: 'middle' }}>
      <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 17 17">
        <rect x="0.75" y="0.75" width="15.5" height="15.5" fill="white" stroke="black" strokeWidth="1.5"/>
        {checked && <text x="8.5" y="13" textAnchor="middle" fontFamily="Arial, sans-serif" fontSize="12" fontWeight="bold" fill="#ff0000">X</text>}
      </svg>
    </div>
  );

  const filteredWarnings = useMemo(() => {
    if (!searchTerm.trim()) return savedWarnings;
    const term = searchTerm.toLowerCase();
    return savedWarnings.filter(w => 
      w.ref.toLowerCase().includes(term) ||
      w.ename.toLowerCase().includes(term) ||
      w.cname.toLowerCase().includes(term) ||
      (w.eid && w.eid.toLowerCase().includes(term))
    );
  }, [savedWarnings, searchTerm]);

  // Styles
  const styles = `
    @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Rajdhani:wght@400;500;600;700&display=swap');

    :root {
      --bg-deep: #080c14;
      --bg-panel: #0d1220;
      --bg-card: #111827;
      --bg-input: #0a0f1a;
      --border: #1e2d47;
      --border-bright: #2a3f62;
      --accent: #00d4ff;
      --accent2: #0088cc;
      --accent-glow: rgba(0, 212, 255, 0.15);
      --warn: #ff6b35;
      --warn-glow: rgba(255, 107, 53, 0.15);
      --success: #00e5a0;
      --text-primary: #e8f0fe;
      --text-secondary: #7a90b0;
      --text-muted: #3d5070;
      --gold: #f5c842;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    .gss-panel {
      width: 400px;
      height: 100vh;
      background: var(--bg-panel);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      font-family: 'Space Grotesk', sans-serif;
      position: relative;
      border-right: 1px solid var(--border);
    }

    .gss-panel::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 2px;
      background: linear-gradient(90deg, transparent, var(--accent), var(--accent2), transparent);
      z-index: 10;
    }

    .panel-header {
      padding: 20px 24px 18px;
      background: linear-gradient(135deg, #0a1220 0%, #0d1828 100%);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
      position: relative;
      overflow: hidden;
    }

    .panel-header::after {
      content: 'GSS';
      position: absolute;
      right: -10px;
      top: 50%;
      transform: translateY(-50%);
      font-family: 'Rajdhani', sans-serif;
      font-size: 72px;
      font-weight: 700;
      color: rgba(0, 212, 255, 0.04);
      letter-spacing: -2px;
      pointer-events: none;
    }

    .header-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: var(--accent-glow);
      border: 1px solid rgba(0, 212, 255, 0.3);
      border-radius: 20px;
      padding: 3px 10px;
      margin-bottom: 10px;
    }

    .badge-dot {
      width: 6px; height: 6px;
      background: var(--accent);
      border-radius: 50%;
      animation: pulse 2s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(0.8); }
    }

    .badge-text {
      font-size: 10px;
      font-weight: 600;
      color: var(--accent);
      letter-spacing: 1.5px;
      text-transform: uppercase;
    }

    .header-title {
      font-family: 'Rajdhani', sans-serif;
      font-size: 22px;
      font-weight: 700;
      color: var(--text-primary);
      letter-spacing: 0.5px;
      line-height: 1.2;
    }

    .header-title span {
      color: var(--accent);
    }

    .header-sub {
      font-size: 11px;
      color: var(--text-secondary);
      margin-top: 4px;
      letter-spacing: 0.3px;
    }

    .panel-scroll {
      flex: 1;
      overflow-y: auto;
      padding: 0;
    }

    .panel-scroll::-webkit-scrollbar { width: 4px; }
    .panel-scroll::-webkit-scrollbar-track { background: transparent; }
    .panel-scroll::-webkit-scrollbar-thumb { background: var(--border-bright); border-radius: 2px; }

    .section {
      padding: 16px 24px;
      border-bottom: 1px solid var(--border);
    }

    .section-label {
      font-size: 10px;
      font-weight: 700;
      color: var(--text-muted);
      letter-spacing: 2px;
      text-transform: uppercase;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .section-label::after {
      content: '';
      flex: 1;
      height: 1px;
      background: var(--border);
    }

    .field-group {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }

    .field-label {
      font-size: 10px;
      font-weight: 600;
      color: var(--text-secondary);
      letter-spacing: 1px;
      text-transform: uppercase;
    }

    .field-input {
      background: var(--bg-input);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 9px 12px;
      color: var(--text-primary);
      font-family: 'Space Grotesk', sans-serif;
      font-size: 13px;
      width: 100%;
      transition: all 0.2s;
      outline: none;
    }

    .field-input:focus {
      border-color: var(--accent);
      background: #0a1422;
      box-shadow: 0 0 0 3px var(--accent-glow);
    }

    .field-input::placeholder { color: var(--text-muted); }

    .field-input option { background: var(--bg-card); color: var(--text-primary); }

    .field-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    .offense-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .offense-item {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 8px 10px;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.15s;
      border: 1px solid transparent;
      position: relative;
    }

    .offense-item:hover {
      background: rgba(0, 212, 255, 0.04);
      border-color: var(--border);
    }

    .offense-item.selected {
      background: rgba(0, 212, 255, 0.07);
      border-color: rgba(0, 212, 255, 0.25);
    }

    .offense-num {
      font-size: 10px;
      font-weight: 700;
      color: var(--accent);
      min-width: 18px;
      padding-top: 1px;
      font-family: 'Rajdhani', sans-serif;
    }

    .offense-item.selected .offense-num {
      color: var(--accent);
    }

    .offense-text {
      font-size: 11.5px;
      color: var(--text-secondary);
      line-height: 1.4;
      flex: 1;
    }

    .offense-item.selected .offense-text {
      color: var(--text-primary);
    }

    .custom-checkbox {
      width: 16px; height: 16px;
      min-width: 16px;
      border: 1.5px solid var(--border-bright);
      border-radius: 3px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
      margin-top: 1px;
    }

    .offense-item.selected .custom-checkbox {
      background: var(--accent);
      border-color: var(--accent);
    }

    .check-icon { color: #000; font-size: 10px; font-weight: 900; display: none; }
    .offense-item.selected .check-icon { display: block; }

    .sub-options {
      margin-left: 38px;
      padding: 8px 0 4px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px;
    }

    .sub-option {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 5px 8px;
      border-radius: 4px;
      cursor: pointer;
      border: 1px solid transparent;
      transition: all 0.15s;
    }

    .sub-option:hover { background: rgba(245, 200, 66, 0.06); border-color: rgba(245, 200, 66, 0.2); }
    .sub-option.sel-sub { background: rgba(245, 200, 66, 0.1); border-color: rgba(245, 200, 66, 0.35); }

    .sub-checkbox {
      width: 13px; height: 13px;
      border: 1.5px solid #3d5070;
      border-radius: 2px;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }

    .sub-option.sel-sub .sub-checkbox { background: var(--gold); border-color: var(--gold); }

    .sub-check { color: #000; font-size: 8px; font-weight: 900; display: none; }
    .sub-option.sel-sub .sub-check { display: block; }

    .sub-label { font-size: 11px; color: var(--text-secondary); }
    .sub-option.sel-sub .sub-label { color: var(--gold); font-weight: 600; }

    .other-toggle {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border-radius: 6px;
      cursor: pointer;
      border: 1px dashed var(--border);
      transition: all 0.2s;
    }

    .other-toggle:hover { border-color: var(--warn); background: var(--warn-glow); }
    .other-toggle.active { border-color: var(--warn); background: var(--warn-glow); border-style: solid; }

    .other-toggle-label { font-size: 12px; color: var(--text-secondary); flex: 1; }
    .other-toggle.active .other-toggle-label { color: var(--warn); }

    .other-badge {
      width: 18px; height: 18px;
      border: 1.5px solid var(--border-bright);
      border-radius: 3px;
      display: flex; align-items: center; justify-content: center;
      transition: all 0.15s;
    }

    .other-toggle.active .other-badge { background: var(--warn); border-color: var(--warn); }
    .other-check { color: #fff; font-size: 9px; font-weight: 900; display: none; }
    .other-toggle.active .other-check { display: block; }

    .other-textarea {
      width: 100%;
      background: var(--bg-input);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 10px 12px;
      color: var(--text-primary);
      font-family: 'Space Grotesk', sans-serif;
      font-size: 12px;
      resize: none;
      height: 64px;
      outline: none;
      transition: all 0.2s;
      margin-top: 8px;
    }

    .other-textarea:focus { border-color: var(--warn); box-shadow: 0 0 0 3px var(--warn-glow); }
    .other-textarea::placeholder { color: var(--text-muted); }

    .email-preview {
      background: var(--bg-deep);
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
    }

    .email-subject-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      background: linear-gradient(90deg, rgba(245, 200, 66, 0.08) 0%, transparent 100%);
      border-bottom: 1px solid var(--border);
    }

    .subject-icon { font-size: 13px; }

    .subject-text {
      flex: 1;
      font-size: 11.5px;
      font-weight: 600;
      color: var(--gold);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .copy-btn {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      border-radius: 4px;
      border: 1px solid;
      background: transparent;
      cursor: pointer;
      font-family: 'Space Grotesk', sans-serif;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.5px;
      transition: all 0.15s;
      flex-shrink: 0;
    }

    .copy-btn-subject {
      border-color: rgba(245, 200, 66, 0.3);
      color: var(--gold);
    }
    .copy-btn-subject:hover { background: rgba(245, 200, 66, 0.1); }
    .copy-btn-subject.copied { background: rgba(245, 200, 66, 0.2); border-color: var(--gold); }

    .copy-btn-body {
      border-color: var(--border-bright);
      color: var(--text-secondary);
    }
    .copy-btn-body:hover { background: rgba(0, 212, 255, 0.08); border-color: var(--accent); color: var(--accent); }
    .copy-btn-body.copied { background: rgba(0, 229, 160, 0.1); border-color: var(--success); color: var(--success); }

    .email-body-wrap {
      padding: 12px 14px;
      max-height: 180px;
      overflow-y: auto;
    }

    .email-body-wrap::-webkit-scrollbar { width: 3px; }
    .email-body-wrap::-webkit-scrollbar-thumb { background: var(--border-bright); }

    .email-body-text {
      font-family: 'Courier New', monospace;
      font-size: 11px;
      color: #6a85a8;
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.6;
    }

    .email-footer {
      display: flex;
      justify-content: flex-end;
      padding: 8px 14px;
      border-top: 1px solid var(--border);
    }

    .panel-footer {
      padding: 16px 24px;
      border-top: 1px solid var(--border);
      background: var(--bg-deep);
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .pdf-btn {
      width: 100%;
      padding: 12px;
      border-radius: 8px;
      border: none;
      cursor: pointer;
      font-family: 'Rajdhani', sans-serif;
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: all 0.2s;
      position: relative;
      overflow: hidden;
      background: linear-gradient(135deg, #ff6b35 0%, #f5c842 100%);
      color: #000;
    }

    .pdf-btn::before {
      content: '';
      position: absolute;
      top: 0; left: -100%;
      width: 100%; height: 100%;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent);
      transition: left 0.4s;
    }

    .pdf-btn:hover::before { left: 100%; }
    .pdf-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(255, 107, 53, 0.35); }
    .pdf-btn:active { transform: translateY(0); }
    .pdf-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }

    .loading-spinner {
      width: 14px; height: 14px;
      border: 2px solid rgba(0,0,0,0.2);
      border-top-color: #000;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
    }

    @keyframes spin { to { transform: rotate(360deg); } }

    .sig-link {
      text-align: center;
      font-size: 11px;
      color: var(--text-muted);
    }

    .sig-link a {
      color: var(--accent);
      text-decoration: none;
      font-weight: 500;
    }

    .sig-link a:hover { color: #fff; text-decoration: underline; }

    .stats-bar {
      display: flex;
      gap: 8px;
      margin-top: 2px;
    }

    .stat-chip {
      flex: 1;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 7px 10px;
      text-align: center;
    }

    .stat-num {
      font-family: 'Rajdhani', sans-serif;
      font-size: 18px;
      font-weight: 700;
      color: var(--accent);
      line-height: 1;
    }

    .stat-label {
      font-size: 9px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-top: 2px;
    }

    .stat-chip.warn-chip .stat-num { color: var(--warn); }
    .stat-chip.gold-chip .stat-num { color: var(--gold); }

    @keyframes auroraShift {
      0%   { background-position: 0% 50%; }
      50%  { background-position: 100% 50%; }
      100% { background-position: 0% 50%; }
    }
    @keyframes orbFloat1 {
      0%,100% { transform: translate(0, 0) scale(1); opacity: 0.55; }
      33%      { transform: translate(40px, -60px) scale(1.15); opacity: 0.8; }
      66%      { transform: translate(-30px, 40px) scale(0.9); opacity: 0.45; }
    }
    @keyframes orbFloat2 {
      0%,100% { transform: translate(0, 0) scale(1); opacity: 0.4; }
      40%      { transform: translate(-55px, 50px) scale(1.2); opacity: 0.65; }
      70%      { transform: translate(35px, -35px) scale(0.85); opacity: 0.3; }
    }
    @keyframes orbFloat3 {
      0%,100% { transform: translate(0, 0) scale(1); opacity: 0.35; }
      50%      { transform: translate(30px, 55px) scale(1.1); opacity: 0.6; }
    }
    @keyframes gridScroll {
      0%   { background-position: 0px 0px; }
      100% { background-position: 28px 28px; }
    }
    @keyframes beamSweep {
      0%   { transform: translateX(-120%) skewX(-15deg); opacity: 0; }
      10%  { opacity: 1; }
      90%  { opacity: 1; }
      100% { transform: translateX(120vw) skewX(-15deg); opacity: 0; }
    }
    @keyframes particleDrift {
      0%   { transform: translateY(100vh) translateX(0px); opacity: 0; }
      10%  { opacity: 1; }
      90%  { opacity: 0.6; }
      100% { transform: translateY(-80px) translateX(20px); opacity: 0; }
    }
    @keyframes vignettePulse {
      0%,100% { opacity: 1; }
      50%      { opacity: 0.7; }
    }

    .preview-area {
      flex-grow: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      padding: 36px 28px 48px;
      position: relative;
      background: #04070f;
      overflow: hidden;
    }

    .preview-area::before {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(125deg, #04070f 0%, #060d1a 20%, #071220 40%, #04070f 60%, #080d18 80%, #04070f 100%);
      background-size: 400% 400%;
      animation: auroraShift 12s ease infinite;
      pointer-events: none;
      z-index: 0;
    }

    .preview-grid-bg {
      position: absolute;
      inset: 0;
      background-image: radial-gradient(circle, rgba(0,212,255,0.22) 1px, transparent 1px);
      background-size: 28px 28px;
      animation: gridScroll 4s linear infinite;
      pointer-events: none;
      z-index: 1;
      mask-image: radial-gradient(ellipse 85% 85% at 50% 50%, black 20%, transparent 100%);
      -webkit-mask-image: radial-gradient(ellipse 85% 85% at 50% 50%, black 20%, transparent 100%);
      opacity: 0.6;
    }

    .preview-orb-1 {
      position: absolute;
      width: 380px; height: 380px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(0,212,255,0.18) 0%, rgba(0,136,204,0.08) 50%, transparent 70%);
      top: -80px; right: 5%;
      animation: orbFloat1 14s ease-in-out infinite;
      pointer-events: none;
      z-index: 1;
      filter: blur(2px);
    }

    .preview-orb-2 {
      position: absolute;
      width: 300px; height: 300px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(0,80,200,0.2) 0%, rgba(0,40,120,0.08) 50%, transparent 70%);
      bottom: 5%; left: -60px;
      animation: orbFloat2 18s ease-in-out infinite;
      pointer-events: none;
      z-index: 1;
      filter: blur(3px);
    }

    .preview-orb-3 {
      position: absolute;
      width: 200px; height: 200px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(255,107,53,0.12) 0%, rgba(255,107,53,0.04) 50%, transparent 70%);
      bottom: 25%; right: 8%;
      animation: orbFloat3 10s ease-in-out infinite;
      pointer-events: none;
      z-index: 1;
      filter: blur(2px);
    }

    .preview-beam {
      position: absolute;
      top: 0; left: 0;
      width: 180px; height: 100%;
      background: linear-gradient(90deg, transparent, rgba(0,212,255,0.04), rgba(0,212,255,0.07), rgba(0,212,255,0.04), transparent);
      animation: beamSweep 8s ease-in-out infinite;
      animation-delay: 3s;
      pointer-events: none;
      z-index: 2;
    }

    .preview-particle {
      position: absolute;
      width: 2px; height: 2px;
      border-radius: 50%;
      background: rgba(0,212,255,0.7);
      pointer-events: none;
      z-index: 2;
    }
    .preview-particle:nth-child(1) { left: 12%; animation: particleDrift 9s ease-in infinite; animation-delay: 0s; }
    .preview-particle:nth-child(2) { left: 28%; animation: particleDrift 12s ease-in infinite; animation-delay: 2s; width:3px; height:3px; background:rgba(0,180,255,0.5); }
    .preview-particle:nth-child(3) { left: 55%; animation: particleDrift 7s ease-in infinite; animation-delay: 4s; }
    .preview-particle:nth-child(4) { left: 72%; animation: particleDrift 11s ease-in infinite; animation-delay: 1s; background:rgba(255,107,53,0.6); }
    .preview-particle:nth-child(5) { left: 88%; animation: particleDrift 8s ease-in infinite; animation-delay: 5.5s; width:3px; height:3px; }
    .preview-particle:nth-child(6) { left: 40%; animation: particleDrift 14s ease-in infinite; animation-delay: 3.5s; background:rgba(245,200,66,0.5); }

    .preview-vignette {
      position: absolute;
      inset: 0;
      background: radial-gradient(ellipse 75% 75% at 50% 50%, transparent 40%, rgba(2,5,12,0.85) 100%);
      pointer-events: none;
      z-index: 2;
      animation: vignettePulse 8s ease-in-out infinite;
    }

    .preview-area::-webkit-scrollbar { width: 5px; }
    .preview-area::-webkit-scrollbar-track { background: transparent; }
    .preview-area::-webkit-scrollbar-thumb { background: var(--border-bright); border-radius: 3px; }

    .preview-top-bar {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 24px;
      z-index: 1;
      width: 210mm;
      max-width: calc(100vw - 450px);
    }

    .preview-bar-text {
      font-family: 'Rajdhani', sans-serif;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 3px;
      text-transform: uppercase;
      color: var(--text-muted);
      white-space: nowrap;
    }

    .preview-bar-line {
      flex: 1;
      height: 1px;
      background: linear-gradient(90deg, var(--border), transparent);
    }

    .preview-bar-dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 8px var(--accent);
      animation: pulse 2s ease-in-out infinite;
    }

    .preview-corner {
      position: absolute;
      width: 18px;
      height: 18px;
      z-index: 3;
      pointer-events: none;
    }
    .preview-corner.tl { top: -1px; left: -1px; border-top: 2px solid var(--accent); border-left: 2px solid var(--accent); }
    .preview-corner.tr { top: -1px; right: -1px; border-top: 2px solid var(--accent); border-right: 2px solid var(--accent); }
    .preview-corner.bl { bottom: -1px; left: -1px; border-bottom: 2px solid var(--accent); border-left: 2px solid var(--accent); }
    .preview-corner.br { bottom: -1px; right: -1px; border-bottom: 2px solid var(--accent); border-right: 2px solid var(--accent); }

    @keyframes scanline {
      0%   { top: -2px; opacity: 0; }
      5%   { opacity: 1; }
      95%  { opacity: 1; }
      100% { top: 100%; opacity: 0; }
    }

    .pdf-frame {
      position: relative;
      z-index: 1;
      border-radius: 2px;
    }

    .pdf-frame-outer {
      position: relative;
      z-index: 1;
      padding: 1px;
      border-radius: 4px;
      background: linear-gradient(135deg,
        rgba(0,212,255,0.5) 0%,
        rgba(0,136,204,0.2) 30%,
        rgba(255,107,53,0.15) 70%,
        rgba(0,212,255,0.4) 100%
      );
      box-shadow:
        0 0 0 1px rgba(0,212,255,0.08),
        0 12px 48px rgba(0,0,0,0.85),
        0 0 60px rgba(0,212,255,0.08),
        0 0 120px rgba(0,212,255,0.04),
        inset 0 0 0 1px rgba(255,255,255,0.02);
    }

    .pdf-frame-outer::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 2px;
      border-radius: 4px 4px 0 0;
      background: linear-gradient(90deg, transparent 0%, rgba(0,212,255,0.8) 30%, rgba(0,212,255,1) 50%, rgba(0,212,255,0.8) 70%, transparent 100%);
      z-index: 4;
    }

    .pdf-frame-outer::after {
      content: '';
      position: absolute;
      left: 0; right: 0;
      height: 2px;
      background: linear-gradient(90deg, transparent, rgba(0,212,255,0.35), rgba(0,212,255,0.6), rgba(0,212,255,0.35), transparent);
      z-index: 5;
      pointer-events: none;
      animation: scanline 5s ease-in-out infinite;
      animation-delay: 1.5s;
    }

    .preview-status-bar {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-top: 14px;
      z-index: 1;
      width: 210mm;
      max-width: calc(100vw - 450px);
      padding: 0 2px;
    }

    .status-item {
      display: flex;
      align-items: center;
      gap: 5px;
      font-family: 'Rajdhani', sans-serif;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      color: var(--text-muted);
    }

    .status-dot {
      width: 5px; height: 5px;
      border-radius: 50%;
      background: var(--success);
      box-shadow: 0 0 6px var(--success);
    }

    .status-dot.warn { background: var(--warn); box-shadow: 0 0 6px var(--warn); }

    .status-sep {
      flex: 1;
      height: 1px;
      background: linear-gradient(90deg, var(--border), transparent);
    }

    .preview-label-tag {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border: 1px solid var(--border);
      border-radius: 20px;
      background: rgba(0,212,255,0.04);
    }

    .preview-label-tag span {
      font-family: 'Rajdhani', sans-serif;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 2px;
      color: rgba(0,212,255,0.5);
      text-transform: uppercase;
    }
  `;

  return (
    <>
      <style>{styles}</style>
      <div style={{ display: 'flex', height: '100vh', background: '#060a12', fontFamily: 'Space Grotesk, sans-serif', overflow: 'hidden' }}>
        <div className="gss-panel">
          <div className="panel-header">
            <div className="header-badge">
              <div className="badge-dot"></div>
              <span className="badge-text">Verbal Warning System</span>
            </div>
            <div className="header-title">GSS <span>Verbal Warning</span></div>
            <div className="header-sub">Global System Solutions International (Pvt) Ltd</div>
            <div className="stats-bar">
              <div className="stat-chip">
                <div className="stat-num">{selectedOffenses.length}</div>
                <div className="stat-label">Offenses</div>
              </div>
              <div className="stat-chip gold-chip">
                <div className="stat-num">{selectedLowPerfSub.length}</div>
                <div className="stat-label">Sub-metrics</div>
              </div>
              <div className="stat-chip warn-chip">
                <div className="stat-num">{showOther ? '1' : '0'}</div>
                <div className="stat-label">Other</div>
              </div>
            </div>
          </div>

          <div className="panel-scroll">
            {viewMode && (
              <div className="section" style={{ backgroundColor: 'rgba(255,107,53,0.1)', borderBottom: '1px solid var(--warn)' }}>
                <div style={{ textAlign: 'center', fontSize: '12px', fontWeight: 'bold', color: 'var(--warn)', padding: '6px 0' }}>
                  🔍 Viewing Mode – Edit disabled
                </div>
              </div>
            )}

            <div className="section">
              <div className="section-label">Case Info</div>
              <div className="field-group">
                <div className="field">
                  <div className="field-label">Reference Number</div>
                  <input className="field-input" name="ref" disabled value={formData.ref || '(Auto-generated on save)'} placeholder="Auto-generated on save" />
                </div>
              </div>
            </div>

            <div className="section">
              <div className="section-label">Oral Counsellor</div>
              <div className="field-group">
                <div className="field-row">
                  <div className="field">
                    <div className="field-label">Name</div>
                    <input className="field-input" name="cname" onChange={handleInputChange} value={formData.cname} placeholder="Full name" disabled={viewMode} />
                  </div>
                  <div className="field">
                    <div className="field-label">Position</div>
                    <select className="field-input" onChange={(e) => {
                      if (e.target.value === '__custom__') { setShowCustomPos(true); setFormData(p => ({ ...p, cpos: '' })); }
                      else { setShowCustomPos(false); setFormData(p => ({ ...p, cpos: e.target.value })); }
                    }} value={formData.cpos} disabled={viewMode}>
                      <option value="">Select</option>
                      <option value="Team Lead - OPS">Team Lead</option>
                      <option value="Asst. Shift Supervisor">Assistant Shift Supervisor</option>
                      <option value="Supervisor">Supervisor</option>
                      <option value="Senior Supervisor">Senior Supervisor</option>
                      <option value="Assistant Supervisor">Assistant Supervisor</option>
                      <option value="Supervisor - MIS & IQA">Supervisor - MIS & IQA</option>
                      <option value="Centre Co-Ordinator ">Centre Co-Ordinator </option>
                      <option value="Centre Manager">Centre Manager</option>
                      <option value="__custom__">Other…</option>
                    </select>
                  </div>
                </div>
                {showCustomPos && (
                  <div className="field">
                    <input className="field-input" name="cpos" onChange={handleInputChange} placeholder="Custom position..." value={formData.cpos} disabled={viewMode} />
                  </div>
                )}
              </div>
            </div>

            <div className="section">
              <div className="section-label">Warned Employee</div>
              <div className="field-row">
                <div className="field">
                  <div className="field-label">Full Name</div>
                  <input className="field-input" name="ename" onChange={handleInputChange} value={formData.ename} placeholder="Employee name" disabled={viewMode} />
                </div>
                <div className="field">
                  <div className="field-label">GID</div>
                  <input className="field-input" name="eid" onChange={handleInputChange} value={formData.eid} placeholder="GID" disabled={viewMode} />
                </div>
              </div>
            </div>

            <div className="section">
              <div className="section-label">Offenses</div>
              <div className="offense-list">
                {offenses.map((text, i) => (
                  <React.Fragment key={i}>
                    <div className={`offense-item${selectedOffenses.includes(i) ? ' selected' : ''}`} onClick={() => toggleOffense(i)} style={{ cursor: viewMode ? 'default' : 'pointer' }}>
                      <span className="offense-num">{String(i + 1).padStart(2, '0')}</span>
                      <span className="offense-text">{text}</span>
                      <div className="custom-checkbox">
                        <span className="check-icon">✓</span>
                      </div>
                    </div>
                    {i === 9 && selectedOffenses.includes(9) && (
                      <div className="sub-options">
                        {lowPerfSubOptions.map(sub => (
                          <div key={sub} className={`sub-option${selectedLowPerfSub.includes(sub) ? ' sel-sub' : ''}`} onClick={() => toggleLowPerfSub(sub)} style={{ cursor: viewMode ? 'default' : 'pointer' }}>
                            <div className="sub-checkbox">
                              <span className="sub-check">✓</span>
                            </div>
                            <span className="sub-label">{sub}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </React.Fragment>
                ))}
              </div>

              <div style={{ marginTop: '10px' }}>
                <div className={`other-toggle${showOther ? ' active' : ''}`} onClick={() => !viewMode && setShowOther(v => !v)} style={{ cursor: viewMode ? 'default' : 'pointer' }}>
                  <span className="other-badge"><span className="other-check">✓</span></span>
                  <span className="other-toggle-label">Performing other disciplinary actions</span>
                </div>
                {showOther && (
                  <textarea className="other-textarea" name="otherdesc" onChange={handleInputChange} placeholder="Describe details..." value={formData.otherdesc} disabled={viewMode} />
                )}
              </div>
            </div>

            <div className="section">
              <div className="section-label">Email Preview</div>
              <div className="email-preview">
                <div className="email-subject-bar">
                  <span className="subject-icon">✉</span>
                  <span className="subject-text">{emailSubject}</span>
                  <button className={`copy-btn copy-btn-subject${copiedSubject ? ' copied' : ''}`} onClick={copySubjectToClipboard}>
                    {copiedSubject ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
                <div className="email-body-wrap">
                  <div className="email-body-text">{emailBody}</div>
                </div>
                <div className="email-footer">
                  <button className={`copy-btn copy-btn-body${copiedBody ? ' copied' : ''}`} onClick={copyBodyToClipboard}>
                    {copiedBody ? '✓ Copied!' : 'Copy Body'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="panel-footer">
            <div className="field" style={{ marginBottom: '8px' }}>
              <div className="field-label">Load Previous Warning</div>
              <input
                type="text"
                className="field-input"
                placeholder="Type to search by ref, name, GID..."
                list="warning-list"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  const match = savedWarnings.find(w => w.ref === e.target.value);
                  if (match) {
                    loadFormData(match.ref);
                  }
                }}
                disabled={loadingRecords}
              />
              <datalist id="warning-list">
                {filteredWarnings.map(w => (
                  <option key={w.ref} value={w.ref}>
                    {w.ref} - {w.ename} ({w.dateTime.date}) {w.eid ? `- ${w.eid}` : ''}
                  </option>
                ))}
              </datalist>
              <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                <button
                  className="copy-btn"
                  style={{ background: 'rgba(0,212,255,0.1)', borderColor: 'var(--border)', flex: 1 }}
                  onClick={() => loadSavedWarnings()}
                  disabled={loadingRecords}
                >
                  {loadingRecords ? 'Loading...' : '⟳ Refresh List'}
                </button>
                {/* 🔒 Delete button: only visible/enabled for Super Admins */}
                <button
                  className="copy-btn"
                  style={{
                    background: isSuperAdmin ? 'rgba(255,107,53,0.1)' : 'rgba(100,100,100,0.1)',
                    borderColor: isSuperAdmin ? 'var(--warn)' : 'var(--border)',
                    color: isSuperAdmin ? 'var(--warn)' : 'var(--text-muted)',
                    cursor: isSuperAdmin && selectedLoadRef && !deleting ? 'pointer' : 'not-allowed',
                    flex: 1
                  }}
                  onClick={() => deleteWarning(selectedLoadRef)}
                  disabled={!selectedLoadRef || deleting || !isSuperAdmin}
                >
                  {deleting ? 'Deleting...' : '🗑 Delete Selected'}
                </button>
              </div>
              {!isSuperAdmin && (
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px', textAlign: 'center' }}>
                  🔒 Delete is only available for Super Admins.
                </div>
              )}
            </div>
            <button className="pdf-btn" onClick={saveFormData} disabled={saving}>
              {saving ? <><div className="loading-spinner"></div> Saving...</> : '✨ Save New Warning'}
            </button>
            <button className="pdf-btn" onClick={resetForm} disabled={saving}>
              🧹 New Form
            </button>
            <button className="pdf-btn" onClick={downloadPDF} disabled={pdfLoading}>
              {pdfLoading ? <><div className="loading-spinner"></div> Generating…</> : <> ↓ Download PDF</>}
            </button>
            <div className="sig-link">
              <a href="https://www.ilovepdf.com/sign-pdf" target="_blank" rel="noopener noreferrer">
                ✍ Create signature at ilovepdf.com
              </a>
            </div>
          </div>
        </div>

        <div className="preview-area">
          <div className="preview-grid-bg"></div>
          <div className="preview-orb-1"></div>
          <div className="preview-orb-2"></div>
          <div className="preview-orb-3"></div>
          <div className="preview-beam"></div>
          <div className="preview-particle"></div>
          <div className="preview-particle"></div>
          <div className="preview-particle"></div>
          <div className="preview-particle"></div>
          <div className="preview-particle"></div>
          <div className="preview-particle"></div>
          <div className="preview-vignette"></div>

          <div className="preview-top-bar">
            <div className="preview-bar-dot"></div>
            <span className="preview-bar-text">Document Preview</span>
            <div className="preview-bar-line"></div>
            <div className="preview-label-tag">
              <span>A4 · PDF</span>
            </div>
          </div>

          <div className="pdf-frame-outer">
            <div className="preview-corner tl"></div>
            <div className="preview-corner tr"></div>
            <div className="preview-corner bl"></div>
            <div className="preview-corner br"></div>

            <div className="pdf-frame">
              <div id="pdf-content" style={{
                width: '210mm', height: '297mm',
                background: 'linear-gradient(160deg, #0b1120 0%, #0d1528 50%, #091018 100%)',
                padding: '12mm 15mm', boxSizing: 'border-box',
                color: '#c8d8f0', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                fontFamily: "'Segoe UI', Arial, sans-serif",
                position: 'relative', overflow: 'hidden',
              }}>
                <div style={{
                  position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none',
                  backgroundImage: 'linear-gradient(rgba(0,180,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,180,255,0.03) 1px, transparent 1px)',
                  backgroundSize: '20mm 20mm',
                }} />
                <div style={{
                  position: 'absolute', top: 0, left: 0, right: 0, height: '3px', zIndex: 2,
                  background: 'linear-gradient(90deg, transparent, #00d4ff 30%, #0088cc 70%, transparent)',
                }} />
                <div style={{
                  position: 'absolute', top: '50%', left: '50%',
                  transform: 'translate(-50%, -50%) rotate(-30deg)',
                  fontSize: '80px', fontWeight: 900, letterSpacing: '10px',
                  color: 'rgba(0,180,255,0.04)', zIndex: 0, pointerEvents: 'none',
                  whiteSpace: 'nowrap', userSelect: 'none',
                }}>VERBAL WARNING</div>

                <div style={{ position: 'relative', zIndex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px', paddingBottom: '10mm', borderBottom: '1px solid rgba(0,180,255,0.2)' }}>
                    <img src="/images/GSS Logo.png" alt="GSS Logo" style={{ width: '140px', height: '80px', objectFit: 'contain', objectPosition: 'left center', filter: 'brightness(0) invert(1) sepia(1) saturate(3) hue-rotate(175deg) brightness(1.2)', opacity: 0.9 }} />
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', fontWeight: 700, fontSize: '12px', marginBottom: '7px', color: '#7aafd4', letterSpacing: '0.5px' }}>
                        REF NO.
                        <div style={{
                          border: '1px solid rgba(0,180,255,0.4)', width: '170px', height: '26px', marginLeft: '8px',
                          display: 'flex', alignItems: 'center', paddingLeft: '8px', fontWeight: 600,
                          background: 'rgba(0,180,255,0.06)', borderRadius: '3px', color: '#00d4ff', fontSize: '12px',
                        }}>{formData.ref || '---'}</div>
                      </div>
                      <div style={{ fontSize: '15px', fontWeight: 800, color: '#e8f4ff', letterSpacing: '0.3px' }}>Global System Solutions International (Pvt) Ltd</div>
                      <div style={{ fontSize: '11px', color: '#4a6a8a', marginTop: '3px' }}>No. 104, Stanley Thilakarathne Road, Nugegoda.</div>
                    </div>
                  </div>

                  <div style={{ textAlign: 'center', margin: '8px 0 12px' }}>
                    <div style={{
                      display: 'inline-block', padding: '4px 20px',
                      border: '1px solid rgba(255,107,53,0.5)',
                      background: 'rgba(255,107,53,0.08)', borderRadius: '3px',
                      fontSize: '11px', fontWeight: 700, letterSpacing: '2.5px', textTransform: 'uppercase',
                      color: '#ff9a6c',
                    }}>⚠ Verbal Admonition Notice</div>
                    <div style={{ fontSize: '11px', color: '#3d5878', marginTop: '4px' }}>All employees of GSS International Pvt. Ltd.</div>
                  </div>

                  <div style={{ background: 'rgba(0,136,204,0.07)', border: '1px solid rgba(0,136,204,0.2)', borderRadius: '4px', padding: '8px 10px', marginBottom: '8px' }}>
                    <div style={{ fontSize: '10px', fontWeight: 700, color: '#00d4ff', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '6px' }}>Oral Counsellor</div>
                    <div style={{ display: 'flex', fontSize: '12.5px', gap: '10px' }}>
                      <div style={{ width: '50%', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ color: '#4a6a8a', flexShrink: 0 }}>Name:</span>
                        <span style={{ color: '#00d4ff', fontWeight: 600, borderBottom: '1px solid rgba(0,180,255,0.3)', flexGrow: 1, paddingBottom: '1px' }}>{formData.cname}</span>
                      </div>
                      <div style={{ width: '50%', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ color: '#4a6a8a', flexShrink: 0 }}>Position:</span>
                        <span style={{ color: '#00d4ff', fontWeight: 600, borderBottom: '1px solid rgba(0,180,255,0.3)', flexGrow: 1, paddingBottom: '1px' }}>{formData.cpos}</span>
                      </div>
                    </div>
                  </div>

                  <div style={{ background: 'rgba(255,107,53,0.05)', border: '1px solid rgba(255,107,53,0.2)', borderRadius: '4px', padding: '8px 10px', marginBottom: '10px' }}>
                    <div style={{ fontSize: '10px', fontWeight: 700, color: '#ff9a6c', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '6px' }}>Warned Employee</div>
                    <div style={{ display: 'flex', fontSize: '12.5px', gap: '10px' }}>
                      <div style={{ width: '60%', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ color: '#4a6a8a', flexShrink: 0 }}>Name:</span>
                        <span style={{ color: '#ff9a6c', fontWeight: 600, borderBottom: '1px solid rgba(255,107,53,0.3)', flexGrow: 1, paddingBottom: '1px' }}>{formData.ename}</span>
                      </div>
                      <div style={{ width: '40%', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ color: '#4a6a8a', flexShrink: 0 }}>GID:</span>
                        <span style={{ color: '#ff9a6c', fontWeight: 600, borderBottom: '1px solid rgba(255,107,53,0.3)', flexGrow: 1, paddingBottom: '1px' }}>{formData.eid}</span>
                      </div>
                    </div>
                  </div>

                  <div style={{ fontSize: '10px', fontWeight: 700, color: '#7aafd4', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '5px' }}>Nature of Offense Committed</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <tbody>
                      {offenses.map((text, i) => {
                        const isSelected = selectedOffenses.includes(i);
                        if (i === 9) {
                          return (
                            <React.Fragment key={i}>
                              <tr style={{ background: isSelected ? 'rgba(255,107,53,0.08)' : 'transparent' }}>
                                <td width="22" style={{ fontSize: '11px', padding: '3px 0', color: isSelected ? '#ff9a6c' : '#2a4060', fontWeight: 700 }}>
                                  {i + 1}.
                                 </td>
                                <td style={{ fontSize: '11.5px', color: isSelected ? '#c8d8f0' : '#3a5878', padding: '3px 0' }}>
                                  {text}
                                 </td>
                                <td align="right" width="28" style={{ verticalAlign: 'middle' }}>
                                  <DarkCheckBox checked={isSelected} />
                                 </td>
                              </tr>
                              {isSelected && lowPerfSubOptions.map((sub, idx) => (
                                <tr key={`${i}-${idx}`} style={{ background: 'rgba(255,107,53,0.04)' }}>
                                  <td width="22"> </td>
                                  <td style={{ fontSize: '11px', paddingLeft: '16px', color: selectedLowPerfSub.includes(sub) ? '#ff9a6c' : '#3a5878', padding: '2px 0 2px 16px' }}>
                                    ↳ {sub}
                                   </td>
                                  <td align="right" width="28" style={{ verticalAlign: 'middle' }}>
                                    <DarkCheckBox checked={selectedLowPerfSub.includes(sub)} />
                                   </td>
                                </tr>
                              ))}
                            </React.Fragment>
                          );
                        }
                        return (
                          <tr key={i} style={{ background: isSelected ? 'rgba(0,136,204,0.07)' : 'transparent', borderBottom: '1px solid rgba(0,100,180,0.08)' }}>
                            <td width="22" style={{ fontSize: '11px', padding: '3px 0', color: isSelected ? '#00d4ff' : '#2a4060', fontWeight: 700 }}>
                              {i + 1}.
                             </td>
                            <td style={{ fontSize: '11.5px', color: isSelected ? '#c8d8f0' : '#3a5878', padding: '3px 0' }}>
                              {text}
                             </td>
                            <td align="right" width="28" style={{ verticalAlign: 'middle' }}>
                              <DarkCheckBox checked={isSelected} />
                             </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  <div style={{ marginTop: '8px', border: '1px solid rgba(245,200,66,0.2)', borderRadius: '4px', padding: '7px 10px', background: showOther ? 'rgba(245,200,66,0.05)' : 'transparent' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: showOther ? '#f5c842' : '#2a4060', letterSpacing: '0.5px' }}>Other Disciplinary Actions & Nature</span>
                      <DarkCheckBox checked={showOther} gold />
                    </div>
                    <div style={{ borderBottom: '1px solid rgba(245,200,66,0.25)', minHeight: '18px', marginTop: '5px', fontSize: '11.5px', fontWeight: 600, color: '#f5c842', paddingBottom: '2px' }}>{formData.otherdesc}</div>
                  </div>

                  <div style={{ display: 'flex', marginTop: '10px', fontSize: '12px', gap: '20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ color: '#4a6a8a' }}>Date of Warning:</span>
                      <span style={{ fontWeight: 700, color: '#00d4ff', background: 'rgba(0,180,255,0.08)', padding: '1px 8px', borderRadius: '3px', border: '1px solid rgba(0,180,255,0.2)' }}>{dateTime.date}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ color: '#4a6a8a' }}>Time:</span>
                      <span style={{ fontWeight: 700, color: '#00d4ff', background: 'rgba(0,180,255,0.08)', padding: '1px 8px', borderRadius: '3px', border: '1px solid rgba(0,180,255,0.2)' }}>{dateTime.time}</span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '18px' }}>
                    <div style={{ textAlign: 'center', width: '260px' }}>
                      <div style={{ height: '30px', borderBottom: '1px solid rgba(0,180,255,0.35)', marginBottom: '4px' }} />
                      <div style={{ fontSize: '10px', color: '#3a5878', letterSpacing: '0.5px' }}>Signature of those who gave the warning</div>
                    </div>
                  </div>
                </div>

                <div style={{ position: 'relative', zIndex: 1 }}>
                  <div style={{ borderTop: '1px solid rgba(0,180,255,0.15)', paddingTop: '10px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: '#7aafd4', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '6px' }}>Statement of Those Who Have Been Warned</div>
                    <p style={{ textAlign: 'justify', fontSize: '11.5px', lineHeight: 1.55, color: '#5a7a9a' }}>I would like to inform you that I have committed the above disciplinary action and I have been verbally reprimanded for that offense and I refrain from any such disciplinary action, and I agree with any action taken by the management in the event of any further disciplinary action.</p>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
                      <div style={{ textAlign: 'center', width: '260px' }}>
                        <div style={{ height: '28px', borderBottom: '1px solid rgba(255,107,53,0.35)', marginBottom: '4px' }} />
                        <div style={{ fontSize: '10px', color: '#3a5878', letterSpacing: '0.5px' }}>Signature of those who have been warned</div>
                      </div>
                    </div>

                    <div style={{ border: '1px solid rgba(255,107,53,0.25)', background: 'rgba(255,107,53,0.05)', borderRadius: '3px', padding: '7px 10px', marginTop: '12px', fontSize: '10.5px', color: '#6a7a8a', lineHeight: 1.5 }}>
                      <span style={{ fontWeight: 700, color: '#ff9a6c' }}>⚠ Should be considered: </span>Management reserves the right to take disciplinary action on the nature of the offense and the damages caused by the offense.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="preview-status-bar">
            <div className="status-item">
              <div className="status-dot"></div>
              <span>Live Preview</span>
            </div>
            <div className="status-item">
              <div className="status-dot warn"></div>
              <span>{selectedOffenses.length} offense{selectedOffenses.length !== 1 ? 's' : ''} selected</span>
            </div>
            <div className="status-sep"></div>
            <div className="status-item">
              <span>210 × 297 mm</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default GSSDisciplinaryForm;