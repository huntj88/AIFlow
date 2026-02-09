import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test-utils/renderWithProviders';
import type { MachineInstance, StateMachineDefinition } from '@/types/machines';

import { MachinesPage } from './MachinesPage';

// ── Mock the stores ────────────────────────────────────────────────────────

const mockFetchDefinitions = vi.fn();
const mockDeleteDefinition = vi.fn().mockResolvedValue(undefined);
const mockFetchInstances = vi.fn();
const mockStartInstance = vi.fn();
const mockResumeInstance = vi.fn().mockResolvedValue(undefined);

const MOCK_DEFINITION: StateMachineDefinition = {
  id: 'def-1',
  name: 'Test Workflow',
  version: 2,
  inputSchema: {},
  outputSchema: {},
  states: {},
  initialState: 'start',
  transitions: [],
  metadata: {
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    description: 'A test definition',
    tags: ['test', 'demo'],
  },
};

const MOCK_INSTANCE: MachineInstance = {
  id: 'inst-1',
  definitionId: 'def-1',
  definitionVersion: 2,
  status: 'running',
  currentState: 'step_1',
  stateData: {},
  input: {},
  history: [],
  logs: [],
  artifacts: [],
  createdAt: '2026-02-01T10:00:00Z',
  updatedAt: '2026-02-01T10:00:00Z',
};

const MOCK_SUSPENDED_INSTANCE: MachineInstance = {
  ...MOCK_INSTANCE,
  id: 'inst-2',
  status: 'suspended',
  currentState: 'step_2',
};

vi.mock('@/hooks/useMachineDefinitions', () => ({
  useMachineDefinitions: () => ({
    definitions: [MOCK_DEFINITION],
    isLoading: false,
    error: null,
    fetchDefinitions: mockFetchDefinitions,
    createDefinition: vi.fn(),
    updateDefinition: vi.fn(),
    deleteDefinition: mockDeleteDefinition,
  }),
}));

vi.mock('@/hooks/useMachineInstances', () => ({
  useMachineInstances: () => ({
    instances: [MOCK_INSTANCE, MOCK_SUSPENDED_INSTANCE],
    currentInstance: null,
    isLoading: false,
    error: null,
    fetchInstances: mockFetchInstances,
    fetchInstance: vi.fn(),
    startInstance: mockStartInstance,
    cancelInstance: vi.fn(),
    resumeInstance: mockResumeInstance,
    subscribeToInstance: vi.fn(),
    handleEvent: vi.fn(),
  }),
}));

// ── Tests ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MachinesPage', () => {
  it('renders the dashboard title', () => {
    renderWithProviders(<MachinesPage />);
    expect(screen.getByText('machines.dashboard.title')).toBeInTheDocument();
  });

  it('renders the definitions section with definition cards', () => {
    renderWithProviders(<MachinesPage />);
    expect(screen.getByText('machines.definitions.title')).toBeInTheDocument();
    expect(screen.getByTestId('definition-card-def-1')).toBeInTheDocument();
    expect(screen.getByTestId('definition-card-def-1')).toHaveTextContent('Test Workflow');
    expect(screen.getByText('A test definition')).toBeInTheDocument();
    expect(screen.getByText('test')).toBeInTheDocument();
    expect(screen.getByText('demo')).toBeInTheDocument();
  });

  it('renders the instances section with instance rows', () => {
    renderWithProviders(<MachinesPage />);
    expect(screen.getByText('machines.instances.title')).toBeInTheDocument();
    expect(screen.getByTestId('instance-row-inst-1')).toBeInTheDocument();
    expect(screen.getByTestId('instance-row-inst-2')).toBeInTheDocument();
  });

  it('renders status badges with correct statuses', () => {
    renderWithProviders(<MachinesPage />);
    expect(screen.getByTestId('status-badge-running')).toBeInTheDocument();
    expect(screen.getByTestId('status-badge-suspended')).toBeInTheDocument();
  });

  it('renders a Resume button for suspended instances only', () => {
    renderWithProviders(<MachinesPage />);
    expect(screen.getByTestId('resume-instance-inst-2')).toBeInTheDocument();
    expect(screen.queryByTestId('resume-instance-inst-1')).not.toBeInTheDocument();
  });

  it('calls resumeInstance when Resume button is clicked', () => {
    renderWithProviders(<MachinesPage />);
    fireEvent.click(screen.getByTestId('resume-instance-inst-2'));
    expect(mockResumeInstance).toHaveBeenCalledWith('inst-2');
  });

  it('renders the Quick Start panel', () => {
    renderWithProviders(<MachinesPage />);
    expect(screen.getByTestId('quick-start-panel')).toBeInTheDocument();
    expect(screen.getByTestId('definition-select')).toBeInTheDocument();
    expect(screen.getByTestId('launch-button')).toBeInTheDocument();
  });

  it('renders Create New button for definitions', () => {
    renderWithProviders(<MachinesPage />);
    expect(screen.getByTestId('create-definition-button')).toBeInTheDocument();
  });

  it('renders filter tabs', () => {
    renderWithProviders(<MachinesPage />);
    expect(screen.getByTestId('status-filter-tabs')).toBeInTheDocument();
    expect(screen.getByTestId('filter-tab-all')).toBeInTheDocument();
    expect(screen.getByTestId('filter-tab-running')).toBeInTheDocument();
    expect(screen.getByTestId('filter-tab-suspended')).toBeInTheDocument();
  });

  it('filters instances when a status tab is clicked', () => {
    renderWithProviders(<MachinesPage />);

    // Click the "running" tab
    fireEvent.click(screen.getByTestId('filter-tab-running'));

    // Only the running instance should be visible
    expect(screen.getByTestId('instance-row-inst-1')).toBeInTheDocument();
    expect(screen.queryByTestId('instance-row-inst-2')).not.toBeInTheDocument();

    // Click "all" to reset
    fireEvent.click(screen.getByTestId('filter-tab-all'));
    expect(screen.getByTestId('instance-row-inst-1')).toBeInTheDocument();
    expect(screen.getByTestId('instance-row-inst-2')).toBeInTheDocument();
  });

  it('fetches definitions and instances on mount', async () => {
    renderWithProviders(<MachinesPage />);
    await waitFor(() => {
      expect(mockFetchDefinitions).toHaveBeenCalled();
      expect(mockFetchInstances).toHaveBeenCalled();
    });
  });

  it('opens confirm dialog when delete is clicked and deletes on confirm', async () => {
    renderWithProviders(<MachinesPage />);
    fireEvent.click(screen.getByTestId('delete-definition-def-1'));
    // Confirm dialog should appear
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
    // Click confirm
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));
    await waitFor(() => {
      expect(mockDeleteDefinition).toHaveBeenCalledWith('def-1');
    });
  });
});
