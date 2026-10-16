import type { ProcedureVideoAutoEditApplyInput, ProcedureVideoAutoEditScene } from '@raspi-system/shared-types';

export const sceneColors = ['#5ab0ff', '#5fd4a0', '#c49bff', '#ff9cbd', '#ffd166'];
export const roundVideoTime = (seconds: number) => Math.round(seconds * 10) / 10;

export function moveSceneBoundary(scenes: ProcedureVideoAutoEditScene[], index: number, seconds: number) {
  if (index < 1 || index >= scenes.length || !Number.isFinite(seconds)) return scenes;
  const min = roundVideoTime(scenes[index - 1].startSeconds + 0.5);
  const max = roundVideoTime(scenes[index].endSeconds - 0.5);
  if (min > max) return scenes;
  const boundary = Math.max(min, Math.min(max, roundVideoTime(seconds)));
  return scenes.map((scene, i) => i === index - 1 ? { ...scene, endSeconds: boundary } : i === index ? { ...scene, startSeconds: boundary } : scene);
}

export function splitScene(scenes: ProcedureVideoAutoEditScene[], seconds: number) {
  if (scenes.length >= 5 || !Number.isFinite(seconds)) return scenes;
  const at = roundVideoTime(seconds);
  const index = scenes.findIndex((scene) => roundVideoTime(at - scene.startSeconds) >= 0.5 && roundVideoTime(scene.endSeconds - at) >= 0.5);
  if (index < 0) return scenes;
  const scene = scenes[index];
  return [...scenes.slice(0, index), { ...scene, endSeconds: at }, { title: '', caption: '', startSeconds: at, endSeconds: scene.endSeconds }, ...scenes.slice(index + 1)];
}

// Like the reference desk, keep the neighbour's name/caption when merging.
export function mergeScene(scenes: ProcedureVideoAutoEditScene[], index: number) {
  if (scenes.length < 2 || index < 0 || index >= scenes.length) return scenes;
  return scenes.flatMap((scene, i) => i === index ? [] : [i === index - 1 ? { ...scene, endSeconds: scenes[index].endSeconds } : index === 0 && i === 1 ? { ...scene, startSeconds: scenes[0].startSeconds } : scene]);
}

export function autoEditApplyInput(suggestionId: string, scenes: ProcedureVideoAutoEditScene[]): ProcedureVideoAutoEditApplyInput {
  return {
    suggestionId,
    comments: scenes.filter((scene) => scene.caption.trim()).map((scene) => ({ atSeconds: roundVideoTime(scene.startSeconds), text: scene.caption.trim() })),
    scenes: scenes.map((scene, index) => ({ title: scene.title.trim() || `場面 ${index + 1}`, startSeconds: roundVideoTime(scene.startSeconds), endSeconds: roundVideoTime(scene.endSeconds) }))
  };
}
