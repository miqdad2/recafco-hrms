import 'dotenv/config';
import { prisma } from '@recafco/db';
import { PERMISSIONS, ROLE_PERMISSIONS, SYSTEM_ROLES, type SystemRoleCode } from '../auth/constants/rbac.constants';
import { hashPassword } from '../auth/password.util';

const MIN_BOOTSTRAP_PASSWORD_LENGTH = 12;

function toTitleCase(code: string): string {
  return code
    .split('_')
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(' ');
}

async function upsertPermissionsAndRoles(): Promise<void> {
  for (const permission of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: permission.code },
      update: { name: permission.name, description: permission.description ?? null },
      create: {
        code: permission.code,
        name: permission.name,
        description: permission.description ?? null,
      },
    });
  }

  for (const roleCode of SYSTEM_ROLES) {
    const role = await prisma.role.upsert({
      where: { code: roleCode },
      update: {},
      create: { code: roleCode, name: toTitleCase(roleCode), isSystemRole: true },
    });

    const permissionCodes: string[] = ROLE_PERMISSIONS[roleCode as SystemRoleCode] ?? [];
    for (const code of permissionCodes) {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { code } });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }
}

async function main(): Promise<void> {
  const username = process.env.BOOTSTRAP_ADMIN_USERNAME;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL || null;

  if (!username || !password) {
    console.error(
      'BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD environment variables are required.',
    );
    process.exitCode = 1;
    return;
  }

  if (password.length < MIN_BOOTSTRAP_PASSWORD_LENGTH) {
    console.error(`BOOTSTRAP_ADMIN_PASSWORD must be at least ${MIN_BOOTSTRAP_PASSWORD_LENGTH} characters.`);
    process.exitCode = 1;
    return;
  }

  console.log('Ensuring permissions and system roles exist...');
  await upsertPermissionsAndRoles();

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    console.log(
      `User "${username}" already exists (id=${existing.id}). Skipping user creation; permissions/roles are up to date.`,
    );
    return;
  }

  const superAdminRole = await prisma.role.findUniqueOrThrow({ where: { code: 'SUPER_ADMIN' } });
  const passwordHash = await hashPassword(password);

  const user = await prisma.user.create({
    data: {
      username,
      email,
      passwordHash,
      mustChangePassword: true,
      userRoles: { create: { roleId: superAdminRole.id } },
    },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: user.id,
      entityType: 'User',
      entityId: user.id,
      action: 'BOOTSTRAP_SUPER_ADMIN_CREATED',
    },
  });

  console.log(`Super admin user "${username}" (id=${user.id}) created with role SUPER_ADMIN.`);
  console.log('Password was not printed. mustChangePassword is set to true.');
}

main()
  .catch((error: unknown) => {
    console.error('Bootstrap failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
