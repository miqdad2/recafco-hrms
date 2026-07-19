import { authorizedRequest, buildQueryString, type PaginatedResult } from './client';

export type EmploymentType = 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'TEMPORARY';
export const EMPLOYMENT_TYPES: EmploymentType[] = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'TEMPORARY'];

export type EmployeeStatus = 'ACTIVE' | 'INACTIVE' | 'ON_LEAVE' | 'RESIGNED' | 'TERMINATED';
/** TERMINATED is excluded — that transition only happens via terminateEmployee(), never a direct status edit. */
export const UPDATABLE_EMPLOYEE_STATUSES: Exclude<EmployeeStatus, 'TERMINATED'>[] = [
  'ACTIVE',
  'INACTIVE',
  'ON_LEAVE',
  'RESIGNED',
];

interface RelationRef {
  id: string;
  name?: string;
  title?: string;
  code: string | null;
}

export interface LinkedUserRef {
  id: string;
  username: string;
  status: string;
  mustChangePassword: boolean;
}

export interface Employee {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  civilId: string | null;
  status: EmployeeStatus;
  employmentType: EmploymentType;
  departmentId: string | null;
  designationId: string | null;
  workLocationId: string | null;
  hireDate: string;
  terminationDate: string | null;
  isMobilePunchAllowed: boolean;
  isDeviceOnly: boolean;
  createdAt: string;
  updatedAt: string;
  department: RelationRef | null;
  designation: RelationRef | null;
  workLocation: RelationRef | null;
  user: LinkedUserRef | null;
}

export interface ListEmployeesParams {
  page?: number;
  limit?: number;
  search?: string | undefined;
  status?: EmployeeStatus | undefined;
  departmentId?: string | undefined;
  designationId?: string | undefined;
  workLocationId?: string | undefined;
}

export interface CreateEmployeeInput {
  employeeCode: string;
  firstName: string;
  lastName: string;
  email?: string | undefined;
  phone?: string | undefined;
  civilId?: string | undefined;
  employmentType: EmploymentType;
  departmentId?: string | undefined;
  designationId?: string | undefined;
  workLocationId?: string | undefined;
  hireDate: string;
  isMobilePunchAllowed?: boolean;
  isDeviceOnly?: boolean;
}

export interface UpdateEmployeeInput {
  firstName?: string;
  lastName?: string;
  email?: string | undefined;
  phone?: string | undefined;
  civilId?: string | undefined;
  employmentType?: EmploymentType;
  status?: Exclude<EmployeeStatus, 'TERMINATED'>;
  departmentId?: string | undefined;
  designationId?: string | undefined;
  workLocationId?: string | undefined;
  isMobilePunchAllowed?: boolean;
  isDeviceOnly?: boolean;
}

export function listEmployees(params: ListEmployeesParams = {}): Promise<PaginatedResult<Employee>> {
  return authorizedRequest<PaginatedResult<Employee>>(`/employees${buildQueryString(params)}`);
}

export function getEmployee(id: string): Promise<Employee> {
  return authorizedRequest<Employee>(`/employees/${id}`);
}

export function createEmployee(input: CreateEmployeeInput): Promise<Employee> {
  return authorizedRequest<Employee>('/employees', { method: 'POST', body: JSON.stringify(input) });
}

export function updateEmployee(id: string, input: UpdateEmployeeInput): Promise<Employee> {
  return authorizedRequest<Employee>(`/employees/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function terminateEmployee(id: string): Promise<Employee> {
  return authorizedRequest<Employee>(`/employees/${id}`, { method: 'DELETE' });
}

export interface CreateUserAccountInput {
  temporaryPassword?: string | undefined;
}

export interface CreateUserAccountResult {
  user: { id: string; username: string; employeeId: string; status: string; mustChangePassword: boolean };
  temporaryPassword: string;
}

export function createEmployeeUserAccount(
  employeeId: string,
  input: CreateUserAccountInput = {},
): Promise<CreateUserAccountResult> {
  return authorizedRequest<CreateUserAccountResult>(`/employees/${employeeId}/create-user`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
