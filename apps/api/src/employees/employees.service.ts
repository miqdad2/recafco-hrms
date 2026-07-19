import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EmployeeStatus, type Prisma } from '@recafco/db';
import { AuditService } from '../audit/audit.service';
import { hashPassword } from '../auth/password.util';
import { validatePasswordPolicy } from '../auth/password-policy.util';
import { toJsonSnapshot } from '../common/audit-snapshot.util';
import { paginate, paginationSkip, type PaginatedResult } from '../common/pagination.util';
import { isUniqueConstraintError } from '../common/prisma-error.util';
import type { RequestContext } from '../common/request-context.util';
import { DatabaseService } from '../database/database.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { CreateEmployeeUserAccountDto } from './dto/create-employee-user-account.dto';
import { ListEmployeesQueryDto } from './dto/list-employees.query.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';

const RELATIONS_INCLUDE = {
  department: { select: { id: true, name: true, code: true } },
  designation: { select: { id: true, title: true, code: true } },
  workLocation: { select: { id: true, name: true, code: true } },
  user: { select: { id: true, username: true, status: true, mustChangePassword: true } },
} satisfies Prisma.EmployeeInclude;

type EmployeeWithRelations = Prisma.EmployeeGetPayload<{ include: typeof RELATIONS_INCLUDE }>;

@Injectable()
export class EmployeesService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly auditService: AuditService,
  ) {}

  private get prisma() {
    return this.databaseService.client;
  }

  private toResponse(employee: EmployeeWithRelations) {
    return { ...employee, fullName: `${employee.firstName} ${employee.lastName}` };
  }

  private async assertReferencesExist(dto: {
    departmentId?: string;
    designationId?: string;
    workLocationId?: string;
  }): Promise<void> {
    if (dto.departmentId) {
      const exists = await this.prisma.department.findUnique({ where: { id: dto.departmentId } });
      if (!exists) {
        throw new BadRequestException('departmentId does not reference an existing department');
      }
    }
    if (dto.designationId) {
      const exists = await this.prisma.designation.findUnique({ where: { id: dto.designationId } });
      if (!exists) {
        throw new BadRequestException('designationId does not reference an existing designation');
      }
    }
    if (dto.workLocationId) {
      const exists = await this.prisma.workLocation.findUnique({ where: { id: dto.workLocationId } });
      if (!exists) {
        throw new BadRequestException('workLocationId does not reference an existing work location');
      }
    }
  }

  async findAll(query: ListEmployeesQueryDto): Promise<PaginatedResult<unknown>> {
    const where: Prisma.EmployeeWhereInput = {};
    if (query.status) {
      where.status = query.status;
    }
    if (query.departmentId) {
      where.departmentId = query.departmentId;
    }
    if (query.designationId) {
      where.designationId = query.designationId;
    }
    if (query.workLocationId) {
      where.workLocationId = query.workLocationId;
    }
    if (query.search) {
      where.OR = [
        { employeeCode: { contains: query.search, mode: 'insensitive' } },
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { lastName: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        include: RELATIONS_INCLUDE,
        skip: paginationSkip(query.page, query.limit),
        take: query.limit,
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      }),
      this.prisma.employee.count({ where }),
    ]);

    return paginate(
      rows.map((row) => this.toResponse(row)),
      total,
      query.page,
      query.limit,
    );
  }

  async findOne(id: string) {
    const employee = await this.prisma.employee.findUnique({ where: { id }, include: RELATIONS_INCLUDE });
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }
    return this.toResponse(employee);
  }

  async create(dto: CreateEmployeeDto, actorUserId: string, context: RequestContext) {
    await this.assertReferencesExist(dto);

    const data: Prisma.EmployeeUncheckedCreateInput = {
      employeeCode: dto.employeeCode,
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email ?? null,
      phone: dto.phone ?? null,
      civilId: dto.civilId ?? null,
      employmentType: dto.employmentType,
      departmentId: dto.departmentId ?? null,
      designationId: dto.designationId ?? null,
      workLocationId: dto.workLocationId ?? null,
      hireDate: new Date(dto.hireDate),
    };
    if (dto.isMobilePunchAllowed !== undefined) {
      data.isMobilePunchAllowed = dto.isMobilePunchAllowed;
    }
    if (dto.isDeviceOnly !== undefined) {
      data.isDeviceOnly = dto.isDeviceOnly;
    }

    try {
      const employee = await this.prisma.employee.create({
        data,
        include: RELATIONS_INCLUDE,
      });

      await this.auditService.record({
        actorUserId,
        entityType: 'Employee',
        entityId: employee.id,
        action: 'EMPLOYEE_CREATED',
        afterSnapshot: toJsonSnapshot(employee),
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return this.toResponse(employee);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('An employee with this code, email, or civil ID already exists');
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateEmployeeDto, actorUserId: string, context: RequestContext) {
    const existing = await this.prisma.employee.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Employee not found');
    }

    await this.assertReferencesExist(dto);

    const data: Prisma.EmployeeUncheckedUpdateInput = { ...dto };

    try {
      const updated = await this.prisma.employee.update({
        where: { id },
        data,
        include: RELATIONS_INCLUDE,
      });

      await this.auditService.record({
        actorUserId,
        entityType: 'Employee',
        entityId: id,
        action: 'EMPLOYEE_UPDATED',
        beforeSnapshot: toJsonSnapshot(existing),
        afterSnapshot: toJsonSnapshot(updated),
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return this.toResponse(updated);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('An employee with this code, email, or civil ID already exists');
      }
      throw error;
    }
  }

  async terminate(id: string, actorUserId: string, context: RequestContext) {
    const existing = await this.prisma.employee.findUnique({ where: { id }, include: RELATIONS_INCLUDE });
    if (!existing) {
      throw new NotFoundException('Employee not found');
    }
    if (existing.status === EmployeeStatus.TERMINATED) {
      return this.toResponse(existing);
    }

    const updated = await this.prisma.employee.update({
      where: { id },
      data: { status: EmployeeStatus.TERMINATED, terminationDate: new Date() },
      include: RELATIONS_INCLUDE,
    });

    await this.auditService.record({
      actorUserId,
      entityType: 'Employee',
      entityId: id,
      action: 'EMPLOYEE_TERMINATED',
      beforeSnapshot: toJsonSnapshot(existing),
      afterSnapshot: toJsonSnapshot(updated),
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return this.toResponse(updated);
  }

  async createUserAccount(
    employeeId: string,
    dto: CreateEmployeeUserAccountDto,
    actorUserId: string,
    context: RequestContext,
  ): Promise<{
    user: { id: string; username: string; employeeId: string; status: string; mustChangePassword: boolean };
    temporaryPassword: string;
  }> {
    const employee = await this.prisma.employee.findUnique({ where: { id: employeeId }, include: { user: true } });
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }
    if (employee.status !== EmployeeStatus.ACTIVE) {
      throw new BadRequestException('Login accounts can only be created for active employees');
    }
    if (employee.user) {
      throw new ConflictException('This employee already has a login account');
    }

    const username = employee.employeeCode;
    const existingUsername = await this.prisma.user.findUnique({ where: { username } });
    if (existingUsername) {
      throw new ConflictException('A user account with this username already exists');
    }

    const temporaryPassword = dto.temporaryPassword ?? `Recafco@${employee.employeeCode}`;
    const policyError = validatePasswordPolicy(temporaryPassword, username);
    if (policyError) {
      throw new BadRequestException(policyError);
    }

    const employeeRole = await this.prisma.role.findUnique({ where: { code: 'EMPLOYEE' } });
    if (!employeeRole) {
      throw new BadRequestException('EMPLOYEE role is not configured — run the RBAC bootstrap first');
    }

    const passwordHash = await hashPassword(temporaryPassword);
    const now = new Date();

    const user = await this.prisma.user.create({
      data: {
        employeeId,
        username,
        passwordHash,
        mustChangePassword: true,
        temporaryPasswordIssuedAt: now,
        userRoles: { create: { roleId: employeeRole.id } },
      },
    });

    await this.auditService.record({
      actorUserId,
      entityType: 'User',
      entityId: user.id,
      action: 'EMPLOYEE_USER_ACCOUNT_CREATED',
      afterSnapshot: toJsonSnapshot({
        id: user.id,
        username: user.username,
        employeeId: user.employeeId,
        status: user.status,
        mustChangePassword: user.mustChangePassword,
        temporaryPasswordIssuedAt: user.temporaryPasswordIssuedAt,
      }),
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return {
      user: {
        id: user.id,
        username: user.username,
        employeeId,
        status: user.status,
        mustChangePassword: user.mustChangePassword,
      },
      temporaryPassword,
    };
  }
}
