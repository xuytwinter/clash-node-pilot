package com.clashnodepilot.companion;

import org.json.JSONArray;
import org.json.JSONObject;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

final class AndroidOptimizer {
    private static final String TEST_URL = "https://www.gstatic.com/generate_204";
    private static final int TIMEOUT_MS = 5000;
    private static final int MAX_CANDIDATES = 30;
    private static final Set<String> GROUP_TYPES = new HashSet<>();

    static {
        GROUP_TYPES.add("Selector");
        GROUP_TYPES.add("URLTest");
        GROUP_TYPES.add("Fallback");
        GROUP_TYPES.add("LoadBalance");
        GROUP_TYPES.add("Relay");
    }

    static final class Inspection {
        final String groupName;
        final int groupCount;
        final int candidateCount;
        final String current;
        final List<RegionSummary> regions;

        Inspection(String groupName, int groupCount, int candidateCount, String current, List<RegionSummary> regions) {
            this.groupName = groupName;
            this.groupCount = groupCount;
            this.candidateCount = candidateCount;
            this.current = current;
            this.regions = regions;
        }
    }

    static final class Result {
        final String groupName;
        final String previous;
        final String bestName;
        final int bestDelay;
        final int tested;
        final int failed;
        final boolean switched;
        final List<NodeResult> rankings;

        Result(String groupName, String previous, String bestName, int bestDelay, int tested, int failed, boolean switched, List<NodeResult> rankings) {
            this.groupName = groupName;
            this.previous = previous;
            this.bestName = bestName;
            this.bestDelay = bestDelay;
            this.tested = tested;
            this.failed = failed;
            this.switched = switched;
            this.rankings = rankings;
        }
    }

    static final class RegionSummary {
        final String id;
        final String label;
        final int count;

        RegionSummary(String id, String label, int count) {
            this.id = id;
            this.label = label;
            this.count = count;
        }
    }

    static final class NodeResult {
        final String name;
        final int delay;
        final boolean ok;
        final boolean best;
        final boolean activeBefore;

        NodeResult(String name, int delay, boolean ok, boolean best, boolean activeBefore) {
            this.name = name;
            this.delay = delay;
            this.ok = ok;
            this.best = best;
            this.activeBefore = activeBefore;
        }
    }

    private static final class SelectorGroup {
        final String name;
        final String current;
        final List<String> members;

        SelectorGroup(String name, String current, List<String> members) {
            this.name = name;
            this.current = current;
            this.members = members;
        }
    }

    private static final class DelayResult {
        final String name;
        final int delay;
        final boolean ok;

        DelayResult(String name, int delay, boolean ok) {
            this.name = name;
            this.delay = delay;
            this.ok = ok;
        }
    }

    static Inspection inspect(ControllerClient client, String preferredGroup, String nodeFilter) throws Exception {
        JSONObject proxies = new JSONObject(client.get("/proxies")).getJSONObject("proxies");
        List<SelectorGroup> groups = selectorGroups(proxies);
        SelectorGroup group = chooseGroup(groups, preferredGroup);
        if (group == null) return new Inspection("", groups.size(), 0, "", new ArrayList<>());
        return new Inspection(group.name, groups.size(), filteredMembers(group, nodeFilter).size(), group.current, summarizeRegions(group.members));
    }

    static Result optimize(ControllerClient client, String preferredGroup, String nodeFilter) throws Exception {
        JSONObject proxies = new JSONObject(client.get("/proxies")).getJSONObject("proxies");
        SelectorGroup group = chooseGroup(selectorGroups(proxies), preferredGroup);
        if (group == null) throw new Exception("No writable Selector group was found.");

        List<String> members = filteredMembers(group, nodeFilter);
        if (members.isEmpty()) throw new Exception("No real candidate nodes matched this group/filter.");
        if (members.size() > MAX_CANDIDATES) members = new ArrayList<>(members.subList(0, MAX_CANDIDATES));

        List<DelayResult> results = new ArrayList<>();
        for (String member : members) results.add(measure(client, member));
        List<DelayResult> ok = new ArrayList<>();
        int failed = 0;
        for (DelayResult result : results) {
            if (result.ok) ok.add(result);
            else failed++;
        }
        if (ok.isEmpty()) throw new Exception("All candidate delay checks failed.");

        ok.sort(Comparator.comparingInt(item -> item.delay));
        DelayResult best = ok.get(0);
        boolean switched = !best.name.equals(group.current);
        if (switched) {
            client.putJson("/proxies/" + encode(group.name), "{\"name\":\"" + jsonEscape(best.name) + "\"}");
        }
        results.sort((left, right) -> {
            if (left.ok != right.ok) return left.ok ? -1 : 1;
            if (!left.ok) return left.name.compareToIgnoreCase(right.name);
            return Integer.compare(left.delay, right.delay);
        });
        List<NodeResult> rankings = new ArrayList<>();
        for (DelayResult item : results) {
            rankings.add(new NodeResult(item.name, item.delay, item.ok, item.ok && item.name.equals(best.name), item.name.equals(group.current)));
        }
        return new Result(group.name, group.current, best.name, best.delay, members.size(), failed, switched, rankings);
    }

    private static List<SelectorGroup> selectorGroups(JSONObject proxies) throws Exception {
        List<SelectorGroup> groups = new ArrayList<>();
        JSONArray names = proxies.names();
        if (names == null) return groups;
        for (int i = 0; i < names.length(); i++) {
            String name = names.getString(i);
            JSONObject proxy = proxies.getJSONObject(name);
            if (!"Selector".equals(proxy.optString("type"))) continue;
            JSONArray all = proxy.optJSONArray("all");
            if (all == null) continue;
            List<String> members = new ArrayList<>();
            for (int j = 0; j < all.length(); j++) {
                String member = all.getString(j);
                JSONObject item = proxies.optJSONObject(member);
                if (item == null) continue;
                String type = item.optString("type");
                if (GROUP_TYPES.contains(type)) continue;
                if ("DIRECT".equals(member) || "REJECT".equals(member)) continue;
                members.add(member);
            }
            if (!members.isEmpty()) groups.add(new SelectorGroup(name, proxy.optString("now"), members));
        }
        return groups;
    }

    private static SelectorGroup chooseGroup(List<SelectorGroup> groups, String preferredGroup) {
        if (groups.isEmpty()) return null;
        String preferred = normalize(preferredGroup);
        if (!preferred.isEmpty()) {
            for (SelectorGroup group : groups) {
                if (normalize(group.name).equals(preferred)) return group;
            }
        }
        String[] priorities = new String[]{"Proxy", "Selector", "\u8282\u70b9\u9009\u62e9", "GLOBAL"};
        for (String priority : priorities) {
            for (SelectorGroup group : groups) {
                if (normalize(group.name).equals(normalize(priority))) return group;
            }
        }
        return groups.get(0);
    }

    private static List<String> filteredMembers(SelectorGroup group, String nodeFilter) {
        String filter = normalizeCompact(nodeFilter);
        if (filter.isEmpty()) return new ArrayList<>(group.members);
        String[] aliases = aliasesFor(filter);
        List<String> members = new ArrayList<>();
        for (String member : group.members) {
            String normalized = normalizeCompact(member);
            for (String alias : aliases) {
                if (normalized.contains(alias)) {
                    members.add(member);
                    break;
                }
            }
        }
        return members;
    }

    private static List<RegionSummary> summarizeRegions(List<String> members) {
        List<RegionSummary> regions = new ArrayList<>();
        addRegion(regions, "hk", "香港", members);
        addRegion(regions, "jp", "日本", members);
        addRegion(regions, "sg", "新加坡", members);
        addRegion(regions, "us", "美国", members);
        return regions;
    }

    private static void addRegion(List<RegionSummary> regions, String id, String label, List<String> members) {
        int count = 0;
        String[] aliases = aliasesFor(id);
        for (String member : members) {
            String normalized = normalizeCompact(member);
            for (String alias : aliases) {
                if (normalized.contains(alias)) {
                    count++;
                    break;
                }
            }
        }
        regions.add(new RegionSummary(id, label, count));
    }

    private static String[] aliasesFor(String filter) {
        switch (filter) {
            case "hk":
            case "hongkong":
            case "香港":
            case "港":
                return new String[]{"hk", "hkg", "hongkong", "香港", "港"};
            case "jp":
            case "japan":
            case "日本":
            case "日":
                return new String[]{"jp", "japan", "tokyo", "osaka", "日本", "东京", "東京", "大阪"};
            case "sg":
            case "singapore":
            case "新加坡":
            case "狮城":
                return new String[]{"sg", "sin", "singapore", "新加坡", "狮城", "獅城"};
            case "us":
            case "usa":
            case "america":
            case "美国":
            case "美國":
            case "美":
                return new String[]{"usa", "america", "unitedstates", "losangeles", "sanjose", "newyork", "美国", "美國", "美"};
            default:
                return new String[]{filter};
        }
    }

    private static DelayResult measure(ControllerClient client, String name) {
        try {
            String body = client.get("/proxies/" + encode(name) + "/delay?timeout=" + TIMEOUT_MS + "&url=" + encode(TEST_URL));
            int delay = new JSONObject(body).optInt("delay", 0);
            return new DelayResult(name, delay, delay > 0);
        } catch (Exception ignored) {
            return new DelayResult(name, 0, false);
        }
    }

    private static String encode(String value) {
        try {
            return URLEncoder.encode(value, "UTF-8").replace("+", "%20");
        } catch (Exception error) {
            return value;
        }
    }

    private static String jsonEscape(String value) {
        return value.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    private static String normalize(String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
    }

    private static String normalizeCompact(String value) {
        return normalize(value).replace(" ", "").replace("_", "").replace("-", "");
    }
}
