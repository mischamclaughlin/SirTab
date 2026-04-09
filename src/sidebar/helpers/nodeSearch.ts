import type { NodeType } from "../types.js";
import { isTabNode, isGroupNode } from "../types.js";

function includesNormalised(value: string | undefined, query: string) {
    if (query.length === 0) return true;
    if (!value) return false;
    return value.toLowerCase().includes(query);
}

export function matchesNodeQuery(node: NodeType, query: string) {
    if (isGroupNode(node)) return includesNormalised(node.title, query);
    if (isTabNode(node)) {
        return (
            includesNormalised(node.title, query) ||
            includesNormalised(node.url, query)
        );
    }

    return (
        includesNormalised(node.title, query) ||
        includesNormalised(node.url, query)
    );
}
