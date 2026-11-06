import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectShareLink, ShareJobState } from 'src/types';
import { ProjectShareStatus } from './ProjectShareStatus';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const api = {
  copyShareLink: vi.fn().mockResolvedValue(true),
  resumeProjectShare: vi.fn().mockResolvedValue({ status: 'idle' }),
  discardProjectShare: vi.fn().mockResolvedValue({ ok: true }),
  openExternalUrl: vi.fn(),
};

const IDLE: ShareJobState = { status: 'idle' };

const link = (over: Partial<ProjectShareLink> = {}): ProjectShareLink => ({
  shareId: 's1',
  title: 'Demo',
  watchUrl: 'https://director.screenforge.co/s/s1',
  expiresAt: '2099-12-06T10:00:00.000Z',
  status: 'live',
  sharedAt: null,
  ...over,
});

beforeEach(() => {
  Object.defineProperty(window, 'screenforge', { value: api, writable: true, configurable: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ProjectShareStatus', () => {
  it('shows nothing for a project that was never shared', () => {
    const { container } = render(
      <ProjectShareStatus projectId="p1" job={IDLE} onRemove={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the link and its expiry, with Copy and Remove', async () => {
    const onRemove = vi.fn();
    const onCardClick = vi.fn();
    render(
      <div onClick={onCardClick}>
        <ProjectShareStatus projectId="p1" link={link()} job={IDLE} onRemove={onRemove} />
      </div>,
    );
    expect(screen.getByText('https://director.screenforge.co/s/s1')).toBeInTheDocument();
    expect(screen.getByText(/^expires /i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /copy link/i }));
    expect(api.copyShareLink).toHaveBeenCalledWith('p1');
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith('Link copied'));

    fireEvent.click(screen.getByRole('button', { name: /remove link/i }));
    expect(onRemove).toHaveBeenCalledWith(link());
    expect(onCardClick).not.toHaveBeenCalled();
  });

  it('says a paid-plan link never expires', () => {
    render(
      <ProjectShareStatus
        projectId="p1"
        link={link({ expiresAt: null })}
        job={IDLE}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText(/never expires/i)).toBeInTheDocument();
  });

  it.each([
    ['expired', /link expired/i],
    ['removed', /link removed/i],
  ] as const)('shows a %s link as such, without Copy', (status, text) => {
    render(
      <ProjectShareStatus projectId="p1" link={link({ status })} job={IDLE} onRemove={vi.fn()} />,
    );
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /copy link/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove link/i })).toBeInTheDocument();
  });

  it('shows upload progress while this project is being shared', () => {
    render(
      <ProjectShareStatus
        projectId="p1"
        link={link()}
        job={{
          status: 'uploading',
          filePath: '/e/demo.mp4',
          projectId: 'p1',
          uploadedBytes: 1,
          totalBytes: 4,
        }}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText('Uploading 25%')).toBeInTheDocument();
  });

  it('offers to resume or discard an upload that stopped', () => {
    render(
      <ProjectShareStatus
        projectId="p1"
        pending={{ fileName: 'demo.mp4', sizeBytes: 10 }}
        job={IDLE}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText(/upload paused/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /resume/i }));
    expect(api.resumeProjectShare).toHaveBeenCalledWith('p1');
    fireEvent.click(screen.getByRole('button', { name: /discard/i }));
    expect(api.discardProjectShare).toHaveBeenCalledWith('p1');
  });
});
