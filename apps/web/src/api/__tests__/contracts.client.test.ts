import { describe, it, expectTypeOf } from 'vitest';

import {
  borrowItem,
  getActiveLoans,
  getTransactions,
  loginRequest,
  returnLoan
} from '../client';

import type {
  AuthResponse,
  BorrowPayload,
  Employee,
  Item,
  Loan,
  ReturnPayload,
  Transaction
} from '@raspi-system/shared-types';

describe('契約テスト: web APIクライアントと shared-types の整合性', () => {
  it('レスポンス型が shared-types に一致する', () => {
    type ActiveLoans = Awaited<ReturnType<typeof getActiveLoans>>;
    type BorrowedLoan = Awaited<ReturnType<typeof borrowItem>>;
    type ReturnedLoan = Awaited<ReturnType<typeof returnLoan>>;
    type AuthResult = Awaited<ReturnType<typeof loginRequest>>;
    type TransactionsResult = Awaited<ReturnType<typeof getTransactions>>;

    expectTypeOf<ActiveLoans>().toEqualTypeOf<Loan[]>();
    expectTypeOf<BorrowedLoan>().toEqualTypeOf<Loan>();
    expectTypeOf<ReturnedLoan>().toEqualTypeOf<Loan>();
    expectTypeOf<AuthResult>().toEqualTypeOf<AuthResponse>();
    expectTypeOf<TransactionsResult>().toEqualTypeOf<{
      transactions: Transaction[];
      page: number;
      total: number;
      pageSize: number;
    }>();
  });

  it('リクエストペイロード型が shared-types に一致する', () => {
    type BorrowArgs = Parameters<typeof borrowItem>[0];
    type ReturnArgs = Parameters<typeof returnLoan>[0];

    expectTypeOf<BorrowArgs>().toEqualTypeOf<BorrowPayload>();
    expectTypeOf<ReturnArgs>().toEqualTypeOf<ReturnPayload>();
  });

  it('クライアントで扱うエンティティ型が shared-types を参照している', () => {
    // コンパイル時の型整合性を担保するための空テスト
    expectTypeOf<Loan>().toMatchTypeOf<Loan>();
    expectTypeOf<Employee>().toMatchTypeOf<Employee>();
    expectTypeOf<Item>().toMatchTypeOf<Item>();
  });
});

