import { MembershipStatus, UserRole } from "@prisma/client";
import { AssignCollectorForm } from "@/features/collector-assignment/components/assign-collector-form";
import { CollectorAssignmentList } from "@/features/collector-assignment/components/collector-assignment-list";
import { CollectorCurrentPeriodCard } from "@/features/collector-assignment/components/collector-current-period-card";
import { CollectorsPageHeader } from "@/features/collector-assignment/components/collectors-page-header";
import { deactivateCollectorAssignmentAction } from "@/features/collector-assignment/actions/deactivate-collector-assignment.action";
import { canDeactivateAssignment } from "@/features/collector-assignment/lib/collector-assignment-rules";
import { getPeriodStatus } from "@/features/collector-assignment/lib/collector-period";
import { getCurrentPeriod, requireChief } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { formatYangonDateTime } from "@/lib/utils";

export const metadata = {
  title: "Collector Assignments | Village Fund Collection System",
};

export default async function CollectorsPage() {
  const { villageId } = await requireChief();
  const currentPeriod = getCurrentPeriod();

  const currentActiveAssignment = await prisma.collectorAssignment.findFirst({
    where: {
      villageId,
      year: currentPeriod.year,
      month: currentPeriod.month,
      isActive: true,
    },
    select: {
      id: true,
      isActive: true,
      user: { select: { name: true } },
    },
  });

  const assignments = await prisma.collectorAssignment.findMany({
    where: { villageId },
    orderBy: [{ year: "desc" }, { month: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      year: true,
      month: true,
      isActive: true,
      createdAt: true,
      user: { select: { name: true } },
    },
  });

  // Chiefs are not eligible collectors (owner decision).
  const eligibleUsers = await prisma.user.findMany({
    where: {
      villageId,
      membershipStatus: MembershipStatus.ACTIVE,
      role: { not: UserRole.CHIEF },
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const assignmentItems = assignments.map((assignment) => {
    const periodStatus = getPeriodStatus(
      assignment.year,
      assignment.month,
      currentPeriod,
    );

    return {
      id: assignment.id,
      year: assignment.year,
      month: assignment.month,
      isActive: assignment.isActive,
      collectorName: assignment.user.name,
      assignedAt: formatYangonDateTime(assignment.createdAt, "date"),
      canDeactivate: canDeactivateAssignment(assignment.isActive, periodStatus),
    };
  });

  return (
    <div className="space-y-6">
      <CollectorsPageHeader />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] xl:items-start">
        <div className="space-y-6">
          <CollectorCurrentPeriodCard
            collectorName={currentActiveAssignment?.user.name ?? null}
            month={currentPeriod.month}
            year={currentPeriod.year}
          />
          <AssignCollectorForm
            currentMonth={currentPeriod.month}
            currentYear={currentPeriod.year}
            eligibleUsers={eligibleUsers}
          />
        </div>

        <CollectorAssignmentList
          assignments={assignmentItems}
          currentPeriod={currentPeriod}
          deactivateAction={deactivateCollectorAssignmentAction}
        />
      </div>
    </div>
  );
}
