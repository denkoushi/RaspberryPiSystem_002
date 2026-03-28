import { useCallback, useEffect, useRef, useState } from 'react';

import { getLocalLlmApiErrorMessage, postLocalLlmChatCompletion } from '../../../api/local-llm';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Input } from '../../../components/ui/Input';

import type { LocalLlmChatCompletionResult } from '../../../api/local-llm.types';

const COOLDOWN_MS = 1500;

export function LocalLlmChatSection() {
  const [userMessage, setUserMessage] = useState('');
  const [maxTokens, setMaxTokens] = useState(512);
  const [temperature, setTemperature] = useState(0.2);
  const [enableThinking, setEnableThinking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LocalLlmChatCompletionResult | null>(null);
  const [cooldownActive, setCooldownActive] = useState(false);
  const cooldownTimerRef = useRef<number | null>(null);

  const canSubmit =
    !loading &&
    !cooldownActive &&
    userMessage.trim().length > 0 &&
    maxTokens >= 1 &&
    maxTokens <= 4096 &&
    temperature >= 0 &&
    temperature <= 2;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await postLocalLlmChatCompletion({
        messages: [{ role: 'user', content: userMessage.trim() }],
        maxTokens,
        temperature,
        enableThinking,
      });
      setResult(data);
    } catch (e) {
      setError(getLocalLlmApiErrorMessage(e));
    } finally {
      setLoading(false);
      setCooldownActive(true);
      if (cooldownTimerRef.current !== null) {
        window.clearTimeout(cooldownTimerRef.current);
      }
      cooldownTimerRef.current = window.setTimeout(() => {
        setCooldownActive(false);
        cooldownTimerRef.current = null;
      }, COOLDOWN_MS);
    }
  }, [canSubmit, userMessage, maxTokens, temperature, enableThinking]);

  useEffect(() => {
    return () => {
      if (cooldownTimerRef.current !== null) {
        window.clearTimeout(cooldownTimerRef.current);
      }
    };
  }, []);

  const userMessageId = 'local-llm-chat-user-message';
  const maxTokensId = 'local-llm-chat-max-tokens';
  const tempId = 'local-llm-chat-temperature';

  return (
    <Card title="試用チャット（1 ユーザー発話）">
      <div className="flex flex-col gap-4">
        <div>
          <label htmlFor={userMessageId} className="mb-1 block text-sm font-semibold text-slate-700">
            メッセージ
          </label>
          <textarea
            id={userMessageId}
            className="min-h-[120px] w-full rounded-md border-2 border-slate-400 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600"
            value={userMessage}
            onChange={(e) => setUserMessage(e.target.value)}
            placeholder="ユーザーとして送る内容（機密は入力しないでください）"
            disabled={loading}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={maxTokensId} className="mb-1 block text-sm font-semibold text-slate-700">
              maxTokens（1〜4096）
            </label>
            <Input
              id={maxTokensId}
              type="number"
              min={1}
              max={4096}
              value={maxTokens}
              onChange={(e) => setMaxTokens(Number(e.target.value) || 1)}
              disabled={loading}
            />
          </div>
          <div>
            <label htmlFor={tempId} className="mb-1 block text-sm font-semibold text-slate-700">
              temperature（0〜2）
            </label>
            <Input
              id={tempId}
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={temperature}
              onChange={(e) => setTemperature(Number(e.target.value) || 0)}
              disabled={loading}
            />
          </div>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-800">
          <input
            type="checkbox"
            checked={enableThinking}
            onChange={(e) => setEnableThinking(e.target.checked)}
            disabled={loading}
            className="h-4 w-4 rounded border-slate-400 text-emerald-600 focus:ring-emerald-600"
          />
          enableThinking
        </label>
        <div>
          <Button type="button" disabled={!canSubmit} onClick={() => void handleSubmit()}>
            {loading ? '送信中…' : '送信'}
          </Button>
        </div>
        {error ? <p className="text-sm font-medium text-red-700">{error}</p> : null}
        {result ? (
          <div className="rounded-md border border-slate-300 bg-slate-50 p-3 text-sm text-slate-900">
            <p className="font-semibold text-slate-700">応答</p>
            <p className="mt-1 break-words">
              <span className="text-slate-600">model: </span>
              {result.model}
            </p>
            {result.finishReason ? (
              <p className="mt-1">
                <span className="text-slate-600">finishReason: </span>
                {result.finishReason}
              </p>
            ) : null}
            {result.usage ? (
              <p className="mt-1 font-mono text-xs text-slate-600">
                usage: prompt={result.usage.promptTokens ?? '—'} completion={result.usage.completionTokens ?? '—'}{' '}
                total={result.usage.totalTokens ?? '—'}
              </p>
            ) : null}
            <p className="mt-2 whitespace-pre-wrap break-words border-t border-slate-200 pt-2">{result.content}</p>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
