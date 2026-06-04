import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import PlanTrackerPanel from '../components/PlanTrackerPanel'
import { usePlans } from '../hooks/usePlans'

export default function PlanningPage() {
  const navigate = useNavigate()
  const plans = usePlans()

  useEffect(() => {
    void plans.refresh()
  }, [plans.refresh])

  return (
    <div className="flex h-screen overflow-hidden bg-gray-950 px-4 text-gray-100 sm:px-6 lg:px-8">
      <PlanTrackerPanel
        isOpen
        variant="workspace"
        title="Planning workspace"
        subtitle="Plan overview, task execution, imports, exports, and metadata backed by durable agent-service state"
        closeLabel="Open chat"
        plans={plans.plans}
        loading={plans.loading}
        error={plans.error}
        onRefresh={plans.refresh}
        onCreatePlan={plans.create}
        onImportPlan={plans.importDocument}
        onExportPlan={plans.exportDocument}
        onPatchPlan={plans.patchPlan}
        onDeletePlan={plans.remove}
        onAddMilestone={plans.addMilestone}
        onUpdateMilestoneStatus={plans.updateMilestoneStatus}
        onDeleteMilestone={plans.removeMilestone}
        onAddTask={plans.addTask}
        onUpdateTaskStatus={plans.updateTaskStatus}
        onPatchTask={plans.patchTask}
        onDeleteTask={plans.removeTask}
        onClose={() => navigate('/')}
      />
    </div>
  )
}
