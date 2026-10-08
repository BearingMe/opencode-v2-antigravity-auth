import { createAntigravityProjectService } from "../antigravity/project.js"
import { createLogger } from "./logger.js"

const projectService = createAntigravityProjectService(createLogger("project"))

/** Clears cached project-context results and pending promises. */
export const invalidateProjectContextCache = projectService.invalidateProjectContextCache

/** Loads managed project information for the given access token and optional project. */
export const loadManagedProject = projectService.loadManagedProject

/** Onboards a managed project, retrying pending requests before advancing endpoints. */
export const onboardManagedProject = projectService.onboardManagedProject

/** Resolves an effective project ID for current auth, caching by refresh credential. */
export const ensureProjectContext = projectService.ensureProjectContext
