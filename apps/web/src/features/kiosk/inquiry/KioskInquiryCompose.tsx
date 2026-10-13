import { isAxiosError } from 'axios';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { postKioskSupport } from '../../../api/client';
import { useKioskEmployees } from '../../../api/hooks';

import { DEFAULT_INQUIRY_REQUEST, readRequestHistory, saveRequestHistory } from './inquiryRequestHistory';
import { useInquirySenderOrder } from './useInquirySenderOrder';

import type { FormEvent } from 'react';

type SenderEmployee = { id: string; displayName: string; department: string | null; section?: string | null };

const DEFAULT_DEPARTMENT_KEYWORD = '機械課';
const PRIMARY_DEPARTMENT_KEYWORDS = [DEFAULT_DEPARTMENT_KEYWORD, '製造課', '組立'];
const departmentRank = (department: string) => PRIMARY_DEPARTMENT_KEYWORDS.findIndex(keyword => department.includes(keyword));
const NO_DEPARTMENT = '';
const NO_DEPARTMENT_LABEL = '部署なし';

// 絞り込みは課(section、例: 機械課)で行う。課が空の社員だけ部(department)で代用する
const departmentOf = (employee: SenderEmployee) =>
  employee.section?.trim() || employee.department?.trim() || NO_DEPARTMENT;

const listDepartments = (employees: SenderEmployee[]) =>
  Array.from(new Set(employees.map(departmentOf))).sort((a, b) => {
    if (a === NO_DEPARTMENT) return 1;
    if (b === NO_DEPARTMENT) return -1;
    const rankA = departmentRank(a);
    const rankB = departmentRank(b);
    if (rankA !== rankB) return (rankA < 0 ? Infinity : rankA) - (rankB < 0 ? Infinity : rankB);
    return a.localeCompare(b, 'ja');
  });

const pickDefaultDepartment = (departments: string[]) =>
  departments.find((department) => department.includes(DEFAULT_DEPARTMENT_KEYWORD)) ?? departments[0] ?? NO_DEPARTMENT;

export function KioskInquiryCompose({ clientKey, onBack, onSent }: {
  clientKey: string;
  onBack: () => void;
  onSent: (threadId: string) => void;
}) {
  const location = useLocation();
  const { data: employees, isLoading } = useKioskEmployees(clientKey);
  const senderEmployees = useMemo<SenderEmployee[]>(() => employees ?? [], [employees]);
  const departments = useMemo(() => listDepartments(senderEmployees), [senderEmployees]);
  const [chosenDepartment, setChosenDepartment] = useState<string | null>(null);
  const [otherDepartmentsOpen, setOtherDepartmentsOpen] = useState(false);
  const selectedDepartment = chosenDepartment !== null && departments.includes(chosenDepartment)
    ? chosenDepartment : pickDefaultDepartment(departments);
  const hasPrimaryDepartments = departments.some(department => departmentRank(department) >= 0);
  const hasOtherDepartments = hasPrimaryDepartments && departments.some(department => departmentRank(department) < 0);
  const visibleDepartments = departments.filter(department => !hasPrimaryDepartments || otherDepartmentsOpen
    || departmentRank(department) >= 0 || department === selectedDepartment);
  const departmentEmployees = useMemo(() => senderEmployees.filter(employee => departmentOf(employee) === selectedDepartment)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'ja')), [senderEmployees, selectedDepartment]);
  const senderIds = useMemo(() => departmentEmployees.map(employee => employee.id), [departmentEmployees]);
  const [selectedSender, setSelectedSender] = useState('');
  const sender = departmentEmployees.find(employee => employee.id === selectedSender);
  const [meetingDate, setMeetingDate] = useState('');
  const [meetingTime, setMeetingTime] = useState('');
  const [message, setMessage] = useState('');
  const [request, setRequest] = useState(DEFAULT_INQUIRY_REQUEST);
  const [history, setHistory] = useState(readRequestHistory);
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyOptions = [DEFAULT_INQUIRY_REQUEST, ...history.filter(entry => entry !== DEFAULT_INQUIRY_REQUEST)];
  const [isSubmitting, setIsSubmitting] = useState(false);
  const senderOrder = useInquirySenderOrder(senderIds, selectedDepartment, isSubmitting || isLoading);
  const [error, setError] = useState<string | null>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const initializedDate = useRef(false);
  const submitting = useRef(false);
  const active = useRef(true);

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!sender || !request.trim() || submitting.current) return;
    submitting.current = true;
    setIsSubmitting(true);
    setError(null);
    let body = `送信者: ${sender.displayName}\n依頼内容: ${request.trim()}`;
    if (detailsRef.current?.open && meetingDate && meetingTime) {
      body += `\n打合せ日時: ${meetingDate} ${meetingTime}`;
    }
    if (message.trim()) body += `\n詳細: ${message.trim()}`;
    try {
      const result = await postKioskSupport({ message: body, page: location.pathname }, clientKey);
      const nextHistory = saveRequestHistory(request, history);
      if (active.current) {
        setHistory(nextHistory);
        onSent(result.threadId);
      }
    } catch (failure) {
      if (active.current) setError(isAxiosError(failure) && failure.response?.status === 429
        ? '少し待ってから送ってください' : '送信できません');
    } finally {
      submitting.current = false;
      if (active.current) setIsSubmitting(false);
    }
  };

  return (
    <form className="kiosk-inquiry kiosk-inquiry__new-form" onSubmit={event => void handleSubmit(event)}
      onKeyDown={event => { if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault(); }}
      aria-label="新規お問い合わせ" aria-busy={isSubmitting}>
      <div className="kiosk-inquiry__thread-header">
        <button type="button" className="kiosk-inquiry__back" aria-label="一覧へ戻る" onClick={onBack} disabled={isSubmitting}>‹</button>
        <strong>新規</strong>
      </div>
      <div className="kiosk-inquiry__fields">
        <fieldset disabled={isSubmitting || isLoading}>
          <legend>部署</legend>
          <div className="kiosk-inquiry__chips">
            {visibleDepartments.map(department => (
              <button key={department} type="button" className="kiosk-inquiry__chip" aria-pressed={department === selectedDepartment}
                onClick={() => { if (department !== selectedDepartment) { setChosenDepartment(department); setSelectedSender(''); } }}>
                {department === NO_DEPARTMENT ? NO_DEPARTMENT_LABEL : department}
              </button>
            ))}
            {hasOtherDepartments ? <button type="button" className="kiosk-inquiry__symbol" aria-label="他の部署"
              aria-expanded={otherDepartmentsOpen} onClick={() => setOtherDepartmentsOpen(open => !open)}>⋯</button> : null}
          </div>
        </fieldset>
        <fieldset disabled={isSubmitting || isLoading}>
          <legend>送信者 <span aria-hidden="true">*</span></legend>
          {isLoading ? <p role="status">読込中…</p> : (
            <div className="kiosk-inquiry__people">
              {senderOrder.order.map(id => {
                const employee = departmentEmployees.find(employee => employee.id === id)!;
                return <button key={id} type="button" className="kiosk-inquiry__chip" aria-pressed={id === selectedSender}
                  data-sender-id={id} aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
                  onPointerDown={event => senderOrder.onPointerDown(event, id)} onPointerMove={senderOrder.onPointerMove}
                  onPointerUp={senderOrder.onPointerUp} onPointerCancel={senderOrder.onPointerCancel}
                  onLostPointerCapture={senderOrder.onPointerCancel}
                  onContextMenu={event => event.preventDefault()}
                  onKeyDown={event => senderOrder.onKeyDown(event, id)}
                  onClick={event => { if (senderOrder.onClick(event)) setSelectedSender(id); }}>{employee.displayName}</button>;
              })}
            </div>
          )}
        </fieldset>
        <div>
          <p className="kiosk-inquiry__label">依頼</p>
          <div className="kiosk-inquiry__request-row">
            <input aria-label="依頼" maxLength={200} value={request} disabled={isSubmitting}
              onChange={event => setRequest(event.target.value)} />
            <button type="button" className="kiosk-inquiry__symbol" aria-label="過去の依頼" aria-expanded={historyOpen}
              disabled={isSubmitting} onClick={() => setHistoryOpen(open => !open)}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <circle cx="12" cy="12" r="9" /><path d="M12 6v6l4 2" />
              </svg>
            </button>
          </div>
          {historyOpen ? <ul className="kiosk-inquiry__history" aria-label="依頼履歴">
            {historyOptions.map(entry => <li key={entry}><button type="button" className="kiosk-inquiry__chip" disabled={isSubmitting}
              onClick={() => { setRequest(entry); setHistoryOpen(false); }}>{entry}</button></li>)}
          </ul> : null}
        </div>
        <details ref={detailsRef} onToggle={event => {
          if (!event.currentTarget.open || initializedDate.current) return;
          initializedDate.current = true;
          const now = new Date();
          setMeetingDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`);
          setMeetingTime(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
        }}>
          <summary>日時・詳細</summary>
          <fieldset className="kiosk-inquiry__extra" disabled={isSubmitting}>
            <label>打合せ日<input type="date" value={meetingDate} onChange={event => setMeetingDate(event.target.value)} /></label>
            <label>打合せ時刻<input type="time" value={meetingTime} onChange={event => setMeetingTime(event.target.value)} /></label>
            <label className="kiosk-inquiry__detail-input">詳細<textarea rows={2} maxLength={500} value={message} onChange={event => setMessage(event.target.value)} /></label>
          </fieldset>
        </details>
      </div>
      <div className="kiosk-inquiry__new-footer">
        {error ? <p className="kiosk-inquiry__error" role="alert">{error}</p> : null}
        <button type="submit" className="kiosk-inquiry__submit" disabled={!sender || !request.trim() || isLoading || isSubmitting}>{isSubmitting ? '送信中…' : '送信'}</button>
      </div>
    </form>
  );
}
