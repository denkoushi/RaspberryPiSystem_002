import { isAxiosError } from 'axios';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { postKioskSupport } from '../../../api/client';
import { useKioskEmployees } from '../../../api/hooks';

import type { FormEvent } from 'react';

type SenderEmployee = { id: string; displayName: string; department: string | null; section?: string | null };

const DEFAULT_DEPARTMENT_KEYWORD = '機械課';
const NO_DEPARTMENT = '';
const NO_DEPARTMENT_LABEL = '部署なし';

// 絞り込みは課(section、例: 機械課)で行う。課が空の社員だけ部(department)で代用する
const departmentOf = (employee: SenderEmployee) =>
  employee.section?.trim() || employee.department?.trim() || NO_DEPARTMENT;

const listDepartments = (employees: SenderEmployee[]) =>
  Array.from(new Set(employees.map(departmentOf))).sort((a, b) => {
    if (a === NO_DEPARTMENT) return 1;
    if (b === NO_DEPARTMENT) return -1;
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
  const selectedDepartment = chosenDepartment !== null && departments.includes(chosenDepartment)
    ? chosenDepartment : pickDefaultDepartment(departments);
  const departmentEmployees = senderEmployees.filter(employee => departmentOf(employee) === selectedDepartment);
  const [selectedSender, setSelectedSender] = useState('');
  const sender = departmentEmployees.find(employee => employee.id === selectedSender);
  const [meetingDate, setMeetingDate] = useState('');
  const [meetingTime, setMeetingTime] = useState('');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
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
    if (!sender || submitting.current) return;
    submitting.current = true;
    setIsSubmitting(true);
    setError(null);
    let body = `送信者: ${sender.displayName}\n依頼内容: 現場まで来てください。`;
    if (detailsRef.current?.open && meetingDate && meetingTime) {
      body += `\n打合せ日時: ${meetingDate} ${meetingTime}`;
    }
    if (message.trim()) body += `\n詳細: ${message.trim()}`;
    try {
      const result = await postKioskSupport({ message: body, page: location.pathname }, clientKey);
      if (active.current) onSent(result.threadId);
    } catch (failure) {
      if (active.current) setError(isAxiosError(failure) && failure.response?.status === 429
        ? '少し待ってから送ってください' : '送信できません');
    } finally {
      submitting.current = false;
      if (active.current) setIsSubmitting(false);
    }
  };

  return (
    <form className="kiosk-inquiry kiosk-inquiry__new-form" onSubmit={event => void handleSubmit(event)} aria-label="新規お問い合わせ" aria-busy={isSubmitting}>
      <div className="kiosk-inquiry__thread-header">
        <button type="button" className="kiosk-inquiry__back" aria-label="一覧へ戻る" onClick={onBack} disabled={isSubmitting}>‹</button>
        <strong>新規</strong>
      </div>
      <div className="kiosk-inquiry__fields">
        <fieldset disabled={isSubmitting || isLoading}>
          <legend>部署</legend>
          <div className="kiosk-inquiry__chips">
            {departments.map(department => (
              <button key={department} type="button" className="kiosk-inquiry__chip" aria-pressed={department === selectedDepartment}
                onClick={() => { if (department !== selectedDepartment) { setChosenDepartment(department); setSelectedSender(''); } }}>
                {department === NO_DEPARTMENT ? NO_DEPARTMENT_LABEL : department}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset disabled={isSubmitting || isLoading}>
          <legend>送信者 <span aria-hidden="true">*</span></legend>
          {isLoading ? <p role="status">読込中…</p> : (
            <div className="kiosk-inquiry__people">
              {departmentEmployees.map(employee => (
                <button key={employee.id} type="button" className="kiosk-inquiry__chip" aria-pressed={employee.id === selectedSender}
                  onClick={() => setSelectedSender(employee.id)}>{employee.displayName}</button>
              ))}
            </div>
          )}
        </fieldset>
        <div>
          <p className="kiosk-inquiry__label">依頼</p>
          <span className="kiosk-inquiry__chip kiosk-inquiry__request">現場まで来てください。</span>
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
        <button type="submit" className="kiosk-inquiry__submit" disabled={!sender || isLoading || isSubmitting}>{isSubmitting ? '送信中…' : '送信'}</button>
      </div>
    </form>
  );
}
