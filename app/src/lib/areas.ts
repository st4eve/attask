// one line under each area's heading; areas missing here show no summary
const summaries: Record<string, string> = {
    Course: "classes, assignments and exams",
    Research: "lab work, papers and experiments",
    Personal: "life outside work",
    Admin: "forms, email and errands",
};

/** The one-line summary shown on an area page, or an empty string. */
export function areaSummary(name: string): string {
    return summaries[name] ?? "";
}
