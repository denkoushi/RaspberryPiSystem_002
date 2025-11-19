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
  | { type: 'SUBMIT' }
  | { type: 'SUCCESS'; loan: Loan }
  | { type: 'FAIL'; message: string };

function isItemEvent(event: BorrowEvent | undefined): event is Extract<BorrowEvent, { type: 'ITEM_SCANNED' }> {
  return event?.type === 'ITEM_SCANNED';
}

function isEmployeeEvent(
  event: BorrowEvent | undefined
): event is Extract<BorrowEvent, { type: 'EMPLOYEE_SCANNED' }> {
  return event?.type === 'EMPLOYEE_SCANNED';
}

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
    initial: 'waitItem',
    context: {},
    states: {
      waitItem: {
        on: {
          ITEM_SCANNED: {
            target: 'waitEmployee',
            actions: assign((ctx: BorrowContext, event: BorrowEvent) => ({
              itemTagUid: event.type === 'ITEM_SCANNED' ? event.uid : ctx.itemTagUid,
              error: undefined
            }))
          }
        }
      },
      waitEmployee: {
        on: {
          EMPLOYEE_SCANNED: {
            target: 'confirm',
            actions: assign((ctx: BorrowContext, event: BorrowEvent) => ({
              employeeTagUid: event.type === 'EMPLOYEE_SCANNED' ? event.uid : ctx.employeeTagUid,
              error: undefined
            }))
          },
          RESET: { target: 'waitItem', actions: assign(() => ({})) }
        }
      },
      confirm: {
        on: {
          SUBMIT: { target: 'submitting' },
          RESET: { target: 'waitItem', actions: assign(() => ({})) }
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
            target: 'waitItem',
            actions: assign({
              error: (_ctx, event) => {
                const typed = event as BorrowEvent | undefined;
                return isFailEvent(typed) ? typed.message : 'エラーが発生しました';
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
          RESET: { target: 'waitItem', actions: assign({ loan: () => undefined, error: () => undefined }) }
        },
        after: {
          4000: { target: 'waitItem', actions: assign({ loan: () => undefined }) }
        }
      }
    }
  });
}
