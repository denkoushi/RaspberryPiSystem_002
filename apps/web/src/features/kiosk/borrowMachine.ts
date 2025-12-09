import { createMachine, assign } from 'xstate';

import type { Loan } from '../../api/types';

interface BorrowContext {
  itemTagUid?: string;
  employeeTagUid?: string;
  error?: string;
  loan?: Loan;
}

type BorrowEvent =
  | { type: 'ITEM_SCANNED'; uid: string }
  | { type: 'EMPLOYEE_SCANNED'; uid: string }
  | { type: 'RESET' }
  | { type: 'SUCCESS'; loan: Loan }
  | { type: 'FAIL'; message: string };

function isSuccessEvent(event: BorrowEvent | undefined): event is Extract<BorrowEvent, { type: 'SUCCESS' }> {
  return event?.type === 'SUCCESS';
}

function isFailEvent(event: BorrowEvent | undefined): event is Extract<BorrowEvent, { type: 'FAIL' }> {
  return event?.type === 'FAIL';
}

export function createBorrowMachine() {
  return createMachine({
    types: {
      context: {} as BorrowContext,
      events: {} as BorrowEvent
    },
    id: 'borrow',
    initial: 'collecting',
    context: {
      itemTagUid: undefined,
      employeeTagUid: undefined,
      error: undefined,
      loan: undefined
    },
    states: {
      // 任意の順序（アイテム→社員、社員→アイテムの両方）でタグを収集する
      collecting: {
        on: {
          ITEM_SCANNED: [
            {
              target: 'submitting',
              guard: ({ context }) => Boolean(context.employeeTagUid),
              actions: assign(({ event }) => ({
                itemTagUid: event?.type === 'ITEM_SCANNED' ? event.uid : undefined,
                error: undefined,
                loan: undefined
              }))
            },
            {
              target: 'collecting',
              actions: assign(({ event }) => ({
                itemTagUid: event?.type === 'ITEM_SCANNED' ? event.uid : undefined,
                employeeTagUid: undefined,
                error: undefined,
                loan: undefined
              }))
            }
          ],
          EMPLOYEE_SCANNED: [
            {
              target: 'submitting',
              guard: ({ context }) => Boolean(context.itemTagUid),
              actions: assign(({ event }) => ({
                employeeTagUid: event?.type === 'EMPLOYEE_SCANNED' ? event.uid : undefined,
                error: undefined,
                loan: undefined
              }))
            },
            {
              target: 'collecting',
              actions: assign(({ event }) => ({
                employeeTagUid: event?.type === 'EMPLOYEE_SCANNED' ? event.uid : undefined,
                itemTagUid: undefined,
                error: undefined,
                loan: undefined
              }))
            }
          ],
          RESET: {
            target: 'collecting',
            actions: assign(() => ({
              itemTagUid: undefined,
              employeeTagUid: undefined,
              error: undefined,
              loan: undefined
            }))
          }
        }
      },
      submitting: {
        on: {
          SUCCESS: {
            target: 'success',
            actions: assign({
              loan: (_ctx, event) => {
                const typed = event as BorrowEvent | undefined;
                return isSuccessEvent(typed) ? typed.loan : undefined;
              },
              error: () => undefined
            })
          },
          FAIL: {
            target: 'collecting',
            actions: assign({
              error: (_ctx, event) => {
                const typed = event as BorrowEvent | undefined;
                return isFailEvent(typed) ? typed.message : '登録エラーが発生しました';
              },
              itemTagUid: () => undefined,
              employeeTagUid: () => undefined
            })
          }
        }
      },
      success: {
        entry: assign({ itemTagUid: () => undefined, employeeTagUid: () => undefined }),
        on: {
          RESET: {
            target: 'collecting',
            actions: assign(() => ({
              itemTagUid: undefined,
              employeeTagUid: undefined,
              error: undefined,
              loan: undefined
            }))
          }
        },
        after: {
          4000: { target: 'collecting', actions: assign({ loan: () => undefined }) }
        }
      }
    }
  });
}
