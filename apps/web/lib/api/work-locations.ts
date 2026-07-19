import { authorizedRequest, buildQueryString, type PaginatedResult } from './client';

export type WorkLocationType = 'OFFICE' | 'FACTORY' | 'WAREHOUSE' | 'PROJECT_SITE';

export const WORK_LOCATION_TYPES: WorkLocationType[] = ['OFFICE', 'FACTORY', 'WAREHOUSE', 'PROJECT_SITE'];

export interface WorkLocation {
  id: string;
  name: string;
  code: string;
  type: WorkLocationType;
  address: string | null;
  latitude: number;
  longitude: number;
  geofenceRadiusMeters: number;
  timezone: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ListWorkLocationsParams {
  page?: number;
  limit?: number;
  search?: string | undefined;
  isActive?: boolean;
  type?: WorkLocationType | undefined;
}

export interface CreateWorkLocationInput {
  name: string;
  code: string;
  type?: WorkLocationType | undefined;
  address?: string | undefined;
  latitude: number;
  longitude: number;
  geofenceRadiusMeters?: number | undefined;
}

export interface UpdateWorkLocationInput {
  name?: string;
  code?: string;
  type?: WorkLocationType | undefined;
  address?: string | undefined;
  latitude?: number;
  longitude?: number;
  geofenceRadiusMeters?: number | undefined;
}

export function listWorkLocations(params: ListWorkLocationsParams = {}): Promise<PaginatedResult<WorkLocation>> {
  return authorizedRequest<PaginatedResult<WorkLocation>>(`/work-locations${buildQueryString(params)}`);
}

export function getWorkLocation(id: string): Promise<WorkLocation> {
  return authorizedRequest<WorkLocation>(`/work-locations/${id}`);
}

export function createWorkLocation(input: CreateWorkLocationInput): Promise<WorkLocation> {
  return authorizedRequest<WorkLocation>('/work-locations', { method: 'POST', body: JSON.stringify(input) });
}

export function updateWorkLocation(id: string, input: UpdateWorkLocationInput): Promise<WorkLocation> {
  return authorizedRequest<WorkLocation>(`/work-locations/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function deactivateWorkLocation(id: string): Promise<WorkLocation> {
  return authorizedRequest<WorkLocation>(`/work-locations/${id}`, { method: 'DELETE' });
}
