import { CloudTimeoutError, withCloudTimeout } from '../cloudTimeout';

describe('withCloudTimeout', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('returns the wrapped result when it settles before the deadline', async () => {
    await expect(withCloudTimeout('quick cloud call', Promise.resolve('ok'), 1000)).resolves.toBe('ok');
  });

  test('rejects with a retryable timeout when the wrapped call never settles', async () => {
    jest.useFakeTimers();
    const promise = withCloudTimeout('storage segment upload', new Promise<string>(() => {}), 90_000);

    jest.advanceTimersByTime(90_000);

    await expect(promise).rejects.toEqual(
      new CloudTimeoutError('storage segment upload', 90_000),
    );
  });

  test('does not let a late wrapped rejection override the timeout error', async () => {
    jest.useFakeTimers();
    let rejectLate!: (error: Error) => void;
    const slow = new Promise<string>((_resolve, reject) => {
      rejectLate = reject;
    });
    const promise = withCloudTimeout('session finalize', slow, 45_000);

    jest.advanceTimersByTime(45_000);
    rejectLate(new Error('late network failure'));

    await expect(promise).rejects.toEqual(new CloudTimeoutError('session finalize', 45_000));
  });
});
