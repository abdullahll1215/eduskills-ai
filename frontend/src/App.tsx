import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import { DialogHost, Loading } from "./components/ui";
import { homeFor, useAuth } from "./context/AuthContext";
import AdminAudit from "./pages/admin/Audit";
import AdminHealth from "./pages/admin/Health";
import AdminMaintenance from "./pages/admin/Maintenance";
import AdminRubric from "./pages/admin/Rubric";
import AdminSettings from "./pages/admin/Settings";
import AdminUsers from "./pages/admin/Users";
import AdvisorInterventions from "./pages/advisor/Interventions";
import CohortReports from "./pages/instructor/CohortReports";
import InstructorConsole from "./pages/instructor/Console";
import EvaluationRecords from "./pages/instructor/EvaluationRecords";
import ProjectsAdmin from "./pages/instructor/Projects";
import StudentReview from "./pages/instructor/StudentReview";
import Login from "./pages/Login";
import Profile from "./pages/Profile";
import Artifacts from "./pages/student/Artifacts";
import Coach from "./pages/student/Coach";
import Dashboard from "./pages/student/Dashboard";
import Feedback from "./pages/student/Feedback";
import GrowthReport from "./pages/student/GrowthReport";
import PeerEvaluation from "./pages/student/PeerEvaluation";
import SelfAssessment from "./pages/student/SelfAssessment";
import TeamGate from "./pages/student/TeamSetup";

function Guard({ roles, children }: { roles?: string[]; children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />;
  return children;
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  return (
    <>
    <DialogHost />
    <Routes>
      <Route path="/login" element={user ? <Navigate to={homeFor(user.role)} replace /> : <Login />} />
      <Route element={<Guard><Layout /></Guard>}>
        <Route path="/profile" element={<Profile />} />

        <Route path="/student" element={<Guard roles={["student"]}><TeamGate><Dashboard /></TeamGate></Guard>} />
        <Route path="/student/self-assessment" element={<Guard roles={["student"]}><TeamGate><SelfAssessment /></TeamGate></Guard>} />
        <Route path="/student/peers" element={<Guard roles={["student"]}><TeamGate><PeerEvaluation /></TeamGate></Guard>} />
        <Route path="/student/report" element={<Guard roles={["student"]}><TeamGate><GrowthReport /></TeamGate></Guard>} />
        <Route path="/student/feedback" element={<Guard roles={["student"]}><TeamGate><Feedback /></TeamGate></Guard>} />
        <Route path="/student/artifacts" element={<Guard roles={["student"]}><Artifacts /></Guard>} />
        <Route path="/student/coach" element={<Guard roles={["student"]}><Coach /></Guard>} />

        <Route path="/instructor" element={<Guard roles={["instructor", "admin"]}><InstructorConsole /></Guard>} />
        <Route path="/instructor/students/:studentId" element={<Guard roles={["instructor", "admin"]}><StudentReview /></Guard>} />
        <Route path="/instructor/reports" element={<Guard roles={["instructor", "admin"]}><CohortReports /></Guard>} />
        <Route path="/instructor/evaluations" element={<Guard roles={["instructor", "admin"]}><EvaluationRecords /></Guard>} />
        <Route path="/instructor/projects" element={<Guard roles={["instructor", "admin"]}><ProjectsAdmin /></Guard>} />

        <Route path="/advisor" element={<Guard roles={["advisor", "admin"]}><AdvisorInterventions /></Guard>} />

        <Route path="/admin" element={<Guard roles={["admin"]}><AdminHealth /></Guard>} />
        <Route path="/admin/users" element={<Guard roles={["admin"]}><AdminUsers /></Guard>} />
        <Route path="/admin/settings" element={<Guard roles={["admin"]}><AdminSettings /></Guard>} />
        <Route path="/admin/rubric" element={<Guard roles={["admin"]}><AdminRubric /></Guard>} />
        <Route path="/admin/maintenance" element={<Guard roles={["admin"]}><AdminMaintenance /></Guard>} />
        <Route path="/admin/audit" element={<Guard roles={["admin"]}><AdminAudit /></Guard>} />
      </Route>
      <Route path="*" element={<Navigate to={user ? homeFor(user.role) : "/login"} replace />} />
    </Routes>
    </>
  );
}
