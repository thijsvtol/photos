import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { invalidatePendingReads } from '../services/pendingReads';

const { adapter } = vi.hoisted(() => ({ adapter: vi.fn() }));
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  const client = actual.default.create({ adapter });
  return { ...actual, default: { ...actual.default, create: () => client } };
});
vi.mock('@capacitor/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@capacitor/core')>();
  return { ...actual, Capacitor: { ...actual.Capacitor, isNativePlatform: () => false } };
});

import { getEvent, getEvents, getPhotos, getPhoto, getPeople, getPerson, getUnattachedPhotos, getUnnamedPeople, getNamedPeople, getPublicNamedPeople, tagPeopleOnPhoto } from '../api';

const response = (config: InternalAxiosRequestConfig): AxiosResponse => ({
  config, status: 200, statusText: 'OK', headers: {},
  data: { events: [], event: { slug: 'one' }, photos: [], people: [] },
});

beforeEach(() => {
  invalidatePendingReads();
  adapter.mockReset().mockImplementation(async (config: InternalAxiosRequestConfig) => response(config));
});

describe('API read sharing through the real Axios interceptors', () => {
  it('shares concurrent event and people reads, then fetches fresh results on a later call', async () => {
    await Promise.all([getEvents(), getEvents(), getEvent('one'), getEvent('one'),
      getNamedPeople(), getNamedPeople(), getPublicNamedPeople('one'), getPublicNamedPeople('one')]);
    expect(adapter).toHaveBeenCalledTimes(4);
    await Promise.all([getEvents(), getEvent('one'), getNamedPeople(), getPublicNamedPeople('one')]);
    expect(adapter).toHaveBeenCalledTimes(8);
  });

  it('does not merge different photo sorts, people filters, or events', async () => {
    await Promise.all([
      getPhotos('one', 'date_desc'), getPhotos('one', 'date_desc'),
      getPhotos('one', 'date_asc'), getPhotos('two', 'date_desc'),
      getPhotos('one', 'date_desc', [1]), getPhotos('one', 'date_desc', [2]),
    ]);
    expect(adapter).toHaveBeenCalledTimes(5);
  });

  it('shares matching admin people pages and photo details without merging different pages or options', async () => {
    await Promise.all([
      getPeople(), getPeople(), getPeople(true),
      getPerson(1), getPerson(1), getPerson(2),
      getUnattachedPhotos(null,100), getUnattachedPhotos(null,100),
      getUnattachedPhotos('cursor',100), getUnattachedPhotos(null,50),
      getUnnamedPeople(), getUnnamedPeople(),
      getPhoto('one','p1'), getPhoto('one','p1'), getPhoto('two','p1'),
    ]);
    expect(adapter).toHaveBeenCalledTimes(10);
  });

  it('invalidates a pending read across a successful mutation', async () => {
    let finishOld!: () => void;
    adapter.mockImplementationOnce((config: InternalAxiosRequestConfig) => new Promise<AxiosResponse>((resolve) => {
      finishOld = () => resolve(response(config));
    }));
    const old = getPublicNamedPeople('one');
    await vi.waitFor(() => expect(adapter).toHaveBeenCalledTimes(1));
    await tagPeopleOnPhoto('photo', [1]);
    await getPublicNamedPeople('one');
    expect(adapter).toHaveBeenCalledTimes(3);
    finishOld();
    await old;
  });

  it('invalidates a pending read across a failed mutation too', async () => {
    let finishOld!: () => void;
    adapter.mockImplementationOnce((config: InternalAxiosRequestConfig) => new Promise<AxiosResponse>((resolve) => {
      finishOld = () => resolve(response(config));
    }));
    const old = getPhotos('one');
    await vi.waitFor(() => expect(adapter).toHaveBeenCalledTimes(1));
    adapter.mockRejectedValueOnce(Object.assign(new Error('Write failed'), { config: { method: 'put' } }));
    await expect(tagPeopleOnPhoto('photo', [1])).rejects.toThrow('Write failed');
    await getPhotos('one');
    expect(adapter).toHaveBeenCalledTimes(3);
    finishOld();
    await old;
  });
});
