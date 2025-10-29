/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { checkCommand } from './checkCommand.js';

describe('checkCommand', () => {
  it('should have correct name', () => {
    expect(checkCommand.name).toBe('check');
  });

  it('should have correct description', () => {
    expect(checkCommand.description).toBe(
      'Execute git diff and run code review using AI',
    );
  });

  it('should have correct kind', () => {
    expect(checkCommand.kind).toBe('built-in');
  });

  it('should have an action function', () => {
    expect(typeof checkCommand.action).toBe('function');
  });
});
