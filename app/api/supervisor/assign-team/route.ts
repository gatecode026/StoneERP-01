import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/api/withAuth';
import { Employee } from '@/lib/models';
import { badRequest, forbidden } from '@/lib/errors';
import { writeAudit } from '@/lib/audit';
import { invalidate as invalidateCache } from '@/lib/cache';

export const dynamic = 'force-dynamic';

const assignSchema = z.object({
  supervisorCode: z.string().trim().min(1, 'Supervisor code is required'),
  employeeCodes: z.array(z.string().trim()).default([]),
});

/**
 * GET /api/supervisor/assign-team
 * Returns:
 * - supervisors: active supervisors with their team count
 * - employees: active employees with their current supervisor assignment
 */
export const GET = withAuth('supervisor', 'view', async (auth) => {
  const allEmployees = await Employee.find({ isVoid: false, status: 'active' })
    .select('empCode name job designation site supervisorCode mobile')
    .sort({ name: 1 })
    .lean();

  // Map of supervisor empCode -> supervisor Name
  const supMap = new Map<string, string>();
  allEmployees.forEach((e) => {
    if (e.job && (/supervisor/i.test(e.job) || e.job === 'Supervisor')) {
      supMap.set(e.empCode, e.name);
    }
  });

  // Calculate team count per supervisor
  const teamCountMap = new Map<string, number>();
  allEmployees.forEach((e) => {
    if (e.supervisorCode) {
      teamCountMap.set(e.supervisorCode, (teamCountMap.get(e.supervisorCode) ?? 0) + 1);
    }
  });

  const supervisors = allEmployees
    .filter((e) => e.job && (/supervisor/i.test(e.job) || e.job === 'Supervisor'))
    .map((s) => ({
      empCode: s.empCode,
      name: s.name,
      job: s.job,
      designation: s.designation || '',
      site: s.site || 'Factory',
      mobile: s.mobile || '',
      teamCount: teamCountMap.get(s.empCode) ?? 0,
    }));

  const employees = allEmployees.map((e) => ({
    empCode: e.empCode,
    name: e.name,
    job: e.job,
    designation: e.designation || '',
    site: e.site || 'Factory',
    supervisorCode: e.supervisorCode || '',
    supervisorName: e.supervisorCode ? (supMap.get(e.supervisorCode) || e.supervisorCode) : '',
    isSupervisor: e.job ? (/supervisor/i.test(e.job) || e.job === 'Supervisor') : false,
  }));

  return { supervisors, employees };
});

/**
 * POST /api/supervisor/assign-team
 * Assigns a list of employees to a supervisor.
 * Validates that no employee already assigned to another supervisor can be re-selected.
 */
export const POST = withAuth('supervisor', 'edit', async (auth) => {
  const body = await auth.json(assignSchema);
  const supervisorCode = body.supervisorCode.toUpperCase();
  const rawCodes = body.employeeCodes.map((c) => c.toUpperCase());
  // Deduplicate and filter out supervisor's own code
  const employeeCodes = [...new Set(rawCodes.filter((c) => c && c !== supervisorCode))];

  // Verify supervisor exists and is active
  const supervisor = await Employee.findOne({ empCode: supervisorCode, isVoid: false, status: 'active' }).lean();
  if (!supervisor) {
    throw badRequest(`Supervisor with code ${supervisorCode} not found or inactive`);
  }

  // If role has scoped permissions (e.g. team/own), they can only edit their own team
  if (auth.scope !== 'all' && auth.user.empCode && auth.user.empCode !== supervisorCode) {
    throw forbidden(`You are only permitted to manage your own team (${auth.user.empCode})`);
  }

  // Find all requested employees in database
  const targetEmployees = await Employee.find({ empCode: { $in: employeeCodes }, isVoid: false, status: 'active' })
    .select('empCode name supervisorCode')
    .lean();

  if (targetEmployees.length !== employeeCodes.length) {
    const foundCodes = new Set(targetEmployees.map((e) => e.empCode));
    const missing = employeeCodes.filter((c) => !foundCodes.has(c));
    throw badRequest(`The following employee codes are invalid or inactive: ${missing.join(', ')}`);
  }

  // CRITICAL REQUIREMENT:
  // "and whose are selected under one supervisor not be reselected so implement this process with proper backend"
  // Check if any of the target employees are already assigned to a DIFFERENT supervisor
  const conflictingEmployees = targetEmployees.filter(
    (e) => e.supervisorCode && e.supervisorCode !== supervisorCode
  );

  if (conflictingEmployees.length > 0) {
    // Look up other supervisors' names for clear error message
    const otherSupCodes = [...new Set(conflictingEmployees.map((e) => e.supervisorCode!))];
    const otherSups = await Employee.find({ empCode: { $in: otherSupCodes } }).select('empCode name').lean();
    const otherSupNames = new Map(otherSups.map((s) => [s.empCode, s.name]));

    const conflictDetails = conflictingEmployees
      .map((e) => `${e.name} (${e.empCode}) is already assigned to supervisor ${otherSupNames.get(e.supervisorCode!) || e.supervisorCode}`)
      .join('; ');

    throw badRequest(`Cannot reassign employees already working under another supervisor: ${conflictDetails}. An employee cannot work under multiple supervisors.`);
  }

  // Find currently assigned workers under this supervisor to determine who is being removed
  const currentAssigned = await Employee.find({ supervisorCode, isVoid: false, status: 'active' })
    .select('empCode name')
    .lean();
  const currentCodes = currentAssigned.map((e) => e.empCode);
  const unassignedCodes = currentCodes.filter((c) => !employeeCodes.includes(c));

  // 1. Unassign employees no longer in the list for this supervisor
  if (unassignedCodes.length > 0) {
    await Employee.updateMany(
      { empCode: { $in: unassignedCodes }, supervisorCode },
      { $set: { supervisorCode: '' } }
    );
  }

  // 2. Assign selected employees to this supervisor
  if (employeeCodes.length > 0) {
    await Employee.updateMany(
      { empCode: { $in: employeeCodes } },
      { $set: { supervisorCode } }
    );
  }

  // Record in audit log
  await writeAudit(
    {
      resource: 'employees',
      refId: supervisorCode,
      action: 'assign_team',
      label: `Assigned ${employeeCodes.length} employees to supervisor ${supervisor.name} (${supervisorCode})`,
      changes: {
        supervisorCode,
        assignedCount: employeeCodes.length,
        assignedCodes: employeeCodes,
        unassignedCodes,
      },
      requestId: auth.requestId,
    },
    auth.user
  );

  invalidateCache('home');

  return NextResponse.json({
    success: true,
    supervisorCode,
    supervisorName: supervisor.name,
    assignedCount: employeeCodes.length,
    assignedCodes: employeeCodes,
    unassignedCount: unassignedCodes.length,
    unassignedCodes,
  });
});
