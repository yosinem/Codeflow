import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';
import {
  Play,
  Settings,
  Code,
  Eye,
  RefreshCw,
  Upload,
  FileCode,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Move,
} from 'lucide-react';

const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.24.1/full/';

type NodeType = 'start' | 'class' | 'end';

interface WorkflowNode {
  id: string;
  type: NodeType;
  label: string;
  file?: string;
  fields?: string[];
  methods?: string[];
  x?: number;
  y?: number;
}

interface WorkflowConnection {
  from: string;
  to: string;
  label?: string;
  fromMethod?: string;
  toMethod?: string;
}

interface ParsedCall {
  type: 'self' | 'attribute' | 'direct';
  target?: string;
  attribute?: string;
  method: string;
}

interface ParsedClass {
  name: string;
  fields: string[];
  methods: string[];
  method_calls: Record<string, ParsedCall[]>;
}

interface ParsedResult {
  classes: Record<string, ParsedClass>;
  error?: string;
}

type PyodideInstance = {
  runPythonAsync: (code: string) => Promise<string>;
};

declare global {
  interface Window {
    loadPyodide?: (config: { indexURL: string }) => Promise<PyodideInstance>;
  }
}

const formatStatus = (message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') => {
  switch (type) {
    case 'success':
      return `✓ ${message}`;
    case 'warning':
      return `⚠ ${message}`;
    case 'error':
      return `✗ ${message}`;
    default:
      return message;
  }
};

const autoLayout = (nodesList: WorkflowNode[], connectionsList: WorkflowConnection[]) => {
  const graph: Record<string, string[]> = {};
  const inDegree: Record<string, number> = {};

  nodesList.forEach((node) => {
    graph[node.id] = [];
    inDegree[node.id] = 0;
  });

  connectionsList.forEach((conn) => {
    if (graph[conn.from] && !graph[conn.from].includes(conn.to)) {
      graph[conn.from].push(conn.to);
      inDegree[conn.to] = (inDegree[conn.to] || 0) + 1;
    }
  });

  const layers: string[][] = [];
  const nodeLayer: Record<string, number> = {};
  const queue: string[] = [];

  Object.keys(inDegree).forEach((nodeId) => {
    if (inDegree[nodeId] === 0) {
      queue.push(nodeId);
      nodeLayer[nodeId] = 0;
    }
  });

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentLayer = nodeLayer[current];

    if (!layers[currentLayer]) {
      layers[currentLayer] = [];
    }
    layers[currentLayer].push(current);

    (graph[current] || []).forEach((child) => {
      inDegree[child]--;
      if (inDegree[child] === 0) {
        nodeLayer[child] = currentLayer + 1;
        queue.push(child);
      }
    });
  }

  const LAYER_WIDTH = 280;
  const NODE_HEIGHT_BASE = 80;
  const VERTICAL_SPACING = 40;
  const START_X = 100;
  const START_Y = 50;

  return nodesList.map((node) => {
    const layer = nodeLayer[node.id] ?? 0;
    const nodesInLayer = layers[layer] || [];
    const indexInLayer = nodesInLayer.indexOf(node.id);

    let yOffset = START_Y;
    for (let i = 0; i < indexInLayer; i += 1) {
      const prevNode = nodesList.find((n) => n.id === nodesInLayer[i]);
      if (!prevNode) continue;
      let prevHeight = NODE_HEIGHT_BASE;
      if (prevNode.type === 'class') {
        prevHeight = 40 + (prevNode.fields?.length || 0) * 18 + (prevNode.methods?.length || 0) * 18 + 10;
      } else if (prevNode.type === 'start' || prevNode.type === 'end') {
        prevHeight = 60;
      }
      yOffset += prevHeight + VERTICAL_SPACING;
    }

    return {
      ...node,
      x: START_X + layer * LAYER_WIDTH,
      y: yOffset,
    };
  });
};

const CodeWorkflowVisualizer = () => {
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [nodes, setNodes] = useState<WorkflowNode[]>([]);
  const [connections, setConnections] = useState<WorkflowConnection[]>([]);
  const [showImportModal, setShowImportModal] = useState(false);
  const [pythonCode, setPythonCode] = useState('');
  const [parseStatus, setParseStatus] = useState('');
  const [pyodide, setPyodide] = useState<PyodideInstance | null>(null);
  const [isLoadingPyodide, setIsLoadingPyodide] = useState(false);

  const [showLabels, setShowLabels] = useState(true);
  const [groupConnections, setGroupConnections] = useState(false);
  const [highlightMode, setHighlightMode] = useState(false);
  const [viewTransform, setViewTransform] = useState({ scale: 1, x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);

  const canvasWrapperRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const panStartRef = useRef<{ x: number; y: number } | null>(null);

  const sampleData = useMemo(() => {
    const sampleNodes: WorkflowNode[] = [
      { id: 'start', type: 'start', label: 'Main', file: 'main.py' },
      {
        id: 'auth',
        type: 'class',
        label: 'AuthService',
        file: 'auth.py',
        fields: ['api_key', 'session'],
        methods: ['login()', 'validate()', 'logout()'],
      },
      {
        id: 'user',
        type: 'class',
        label: 'UserController',
        file: 'user.py',
        fields: ['db_connection', 'cache'],
        methods: ['getUser()', 'updateUser()', 'deleteUser()'],
      },
      {
        id: 'audit',
        type: 'class',
        label: 'AuditTrail',
        file: 'audit.py',
        fields: ['events', 'writer'],
        methods: ['record()', 'flush()', 'archive()'],
      },
    ];

    const sampleConnections: WorkflowConnection[] = [
      { from: 'start', to: 'auth', toMethod: 'login()', label: 'authenticate' },
      { from: 'auth', to: 'user', fromMethod: 'validate()', toMethod: 'getUser()', label: 'load user' },
      { from: 'user', to: 'audit', fromMethod: 'updateUser()', toMethod: 'record()', label: 'audit change' },
    ];

    return { sampleNodes, sampleConnections };
  }, []);

  useEffect(() => {
    const positioned = autoLayout(sampleData.sampleNodes, sampleData.sampleConnections);
    setNodes(positioned);
    setConnections(sampleData.sampleConnections);
  }, [sampleData]);

  useEffect(() => {
    const script = document.createElement('script');
    script.src = `${PYODIDE_URL}pyodide.js`;
    script.async = true;
    document.body.appendChild(script);

    return () => {
      if (document.body.contains(script)) {
        document.body.removeChild(script);
      }
    };
  }, []);

  const loadPyodide = async () => {
    if (pyodide) return pyodide;
    if (!window.loadPyodide) {
      setParseStatus(formatStatus('Pyodide script not loaded yet', 'warning'));
      return null;
    }

    setIsLoadingPyodide(true);
    setParseStatus('Loading Python parser... (first time only, ~10MB)');

    try {
      const pyodideInstance = await window.loadPyodide({ indexURL: PYODIDE_URL });
      setPyodide(pyodideInstance);
      setParseStatus(formatStatus('Python parser loaded successfully!', 'success'));
      setIsLoadingPyodide(false);
      return pyodideInstance;
    } catch (error) {
      const err = error as Error;
      setParseStatus(formatStatus(`Failed to load parser: ${err.message}`, 'error'));
      setIsLoadingPyodide(false);
      return null;
    }
  };

  const parsePythonCode = async (code: string) => {
    if (!code.trim()) {
      setParseStatus(formatStatus('Please provide some Python code', 'warning'));
      return;
    }

    setParseStatus('Initializing Python parser...');

    try {
      const pyodideInstance = await loadPyodide();
      if (!pyodideInstance) return;

      setParseStatus('Analyzing code structure...');

      const parserScript = `
import ast
import json

def parse_python_code(code):
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return {"error": f"Syntax error: {str(e)}"}

    classes = {}

    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            class_name = node.name
            classes[class_name] = {
                "name": class_name,
                "fields": set(),
                "methods": [],
                "method_calls": {}
            }

            for item in node.body:
                if isinstance(item, ast.FunctionDef):
                    method_name = item.name
                    if method_name != '__init__':
                        classes[class_name]["methods"].append(method_name + "()")

                    for stmt in ast.walk(item):
                        if isinstance(stmt, ast.Assign):
                            for target in stmt.targets:
                                if isinstance(target, ast.Attribute):
                                    if isinstance(target.value, ast.Name) and target.value.id == 'self':
                                        classes[class_name]["fields"].add(target.attr)

                    classes[class_name]["method_calls"][method_name] = []

                    for stmt in ast.walk(item):
                        if isinstance(stmt, ast.Call):
                            call_info = None

                            if isinstance(stmt.func, ast.Attribute):
                                if isinstance(stmt.func.value, ast.Name) and stmt.func.value.id == 'self':
                                    call_info = {
                                        "type": "self",
                                        "target": class_name,
                                        "method": stmt.func.attr + "()"
                                    }

                                elif isinstance(stmt.func.value, ast.Attribute):
                                    if isinstance(stmt.func.value.value, ast.Name) and stmt.func.value.value.id == 'self':
                                        attr_name = stmt.func.value.attr
                                        method_name_called = stmt.func.attr
                                        call_info = {
                                            "type": "attribute",
                                            "attribute": attr_name,
                                            "method": method_name_called + "()"
                                        }

                                elif isinstance(stmt.func.value, ast.Name):
                                    class_target = stmt.func.value.id
                                    method_called = stmt.func.attr
                                    if class_target in classes:
                                        call_info = {
                                            "type": "direct",
                                            "target": class_target,
                                            "method": method_called + "()"
                                        }

                            if call_info:
                                classes[class_name]["method_calls"][method_name].append(call_info)

    attr_to_class = {}

    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            class_name = node.name
            for item in node.body:
                if isinstance(item, ast.FunctionDef):
                    for stmt in ast.walk(item):
                        if isinstance(stmt, ast.Assign):
                            for target in stmt.targets:
                                if isinstance(target, ast.Attribute):
                                    if isinstance(target.value, ast.Name) and target.value.id == 'self':
                                        attr_name = target.attr
                                        if isinstance(stmt.value, ast.Call):
                                            if isinstance(stmt.value.func, ast.Name):
                                                target_class = stmt.value.func.id
                                                if target_class in classes:
                                                    key = f"{class_name}.{attr_name}"
                                                    attr_to_class[key] = target_class

    for class_name, class_data in classes.items():
        for method_name, calls in class_data["method_calls"].items():
            for call in calls:
                if call["type"] == "attribute":
                    attr_name = call["attribute"]
                    key = f"{class_name}.{attr_name}"

                    if key in attr_to_class:
                        call["target"] = attr_to_class[key]
                    else:
                        for target_class in classes.keys():
                            if attr_name.lower() in target_class.lower() or target_class.lower() in attr_name.lower():
                                call["target"] = target_class
                                break

    for class_data in classes.values():
        class_data["fields"] = list(class_data["fields"])

    return {"classes": classes}

parse_result = parse_python_code
`;

      await pyodideInstance.runPythonAsync(parserScript);

      const sanitizedCode = JSON.stringify(code);

      const result = await pyodideInstance.runPythonAsync(`
import json
result = parse_result(${sanitizedCode})
json.dumps(result)
`);

      const parseResult: ParsedResult = JSON.parse(result);

      if (parseResult.error) {
        setParseStatus(formatStatus(parseResult.error, 'error'));
        return;
      }

      const parsedNodes: WorkflowNode[] = [];
      const parsedConnections: WorkflowConnection[] = [];
      let nodeId = 1;
      const classToId: Record<string, string> = {};

      parsedNodes.push({ id: 'start', type: 'start', label: 'Main', file: 'main.py' });

      Object.keys(parseResult.classes).forEach((className) => {
        const classData = parseResult.classes[className];
        const id = `class_${nodeId++}`;
        classToId[className] = id;

        parsedNodes.push({
          id,
          type: 'class',
          label: className,
          file: `${className.toLowerCase()}.py`,
          fields: classData.fields,
          methods: classData.methods,
        });
      });

      parsedNodes.push({ id: 'end', type: 'end', label: 'Return', file: 'return' });

      Object.keys(parseResult.classes).forEach((className) => {
        const classData = parseResult.classes[className];
        const sourceId = classToId[className];

        Object.keys(classData.method_calls).forEach((methodName) => {
          const calls = classData.method_calls[methodName];

          calls.forEach((call) => {
            if (call.target && classToId[call.target]) {
              const targetId = classToId[call.target];

              if (sourceId !== targetId) {
                const targetNode = parsedNodes.find((n) => n.id === targetId);
                const methodExists = targetNode?.methods?.includes(call.method);

                if (methodExists) {
                  const exists = parsedConnections.some(
                    (c) =>
                      c.from === sourceId &&
                      c.to === targetId &&
                      c.fromMethod === `${methodName}()` &&
                      c.toMethod === call.method,
                  );

                  if (!exists) {
                    parsedConnections.push({
                      from: sourceId,
                      fromMethod: `${methodName}()`,
                      to: targetId,
                      toMethod: call.method,
                      label: call.method.replace('()', ''),
                    });
                  }
                }
              }
            }
          });
        });
      });

      const firstClassId = Object.values(classToId)[0];
      if (firstClassId) {
        const node = parsedNodes.find((n) => n.id === firstClassId);
        if (node?.methods?.length) {
          parsedConnections.push({
            from: 'start',
            to: firstClassId,
            toMethod: node.methods[0],
            label: 'call',
          });
        }
      }

      if (parsedNodes.length > 2) {
        const positioned = autoLayout(parsedNodes, parsedConnections);
        setNodes(positioned);
        setConnections(parsedConnections);

        const classCount = Object.keys(parseResult.classes).length;
        const methodCount = Object.values(parseResult.classes).reduce(
          (sum, c) => sum + c.methods.length,
          0,
        );

        setParseStatus(
          formatStatus(
            `Parsed ${classCount} classes, ${methodCount} methods, ${parsedConnections.length} connections`,
            'success',
          ),
        );
        setTimeout(() => setShowImportModal(false), 1500);
      } else {
        setParseStatus(formatStatus('No classes found. Please check your Python code.', 'warning'));
      }
    } catch (error) {
      const err = error as Error;
      setParseStatus(formatStatus(`Error: ${err.message}`, 'error'));
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        setPythonCode(content);
        setParseStatus('File loaded. Click "Parse Code" to visualize.');
      };
      reader.readAsText(file);
    }
  };

  const relayout = () => {
    const positioned = autoLayout(nodes, connections);
    setNodes(positioned);
  };

  const getDisplayConnections = () => {
    if (!groupConnections) return connections;

    const grouped: Record<string, WorkflowConnection & { count: number; methods: (string | undefined)[] }> = {};

    connections.forEach((conn) => {
      const key = `${conn.from}-${conn.to}`;
      if (!grouped[key]) {
        grouped[key] = {
          ...conn,
          count: 1,
          methods: [conn.toMethod],
        };
      } else {
        grouped[key].count += 1;
        grouped[key].methods.push(conn.toMethod);
        grouped[key].label = `${grouped[key].count} calls`;
        grouped[key].fromMethod = undefined;
        grouped[key].toMethod = undefined;
      }
    });

    return Object.values(grouped);
  };

  const clampScale = (value: number) => Math.max(0.4, Math.min(2.5, value));

  const getNodeById = (nodeId: string) => nodes.find((n) => n.id === nodeId);

  const getNodeBounds = useCallback((node: WorkflowNode & { x: number; y: number }) => {
    if (node.type === 'start' || node.type === 'end') {
      return { x: node.x, y: node.y, width: 80, height: 60 };
    }

    const nodeHeight = 40 + (node.fields?.length || 0) * 18 + (node.methods?.length || 0) * 18 + 10;
    return { x: node.x, y: node.y, width: 200, height: nodeHeight };
  }, []);

  const getMethodPosition = (nodeId: string, methodName?: string, isSource = true) => {
    const node = getNodeById(nodeId);
    if (!node || node.x === undefined || node.y === undefined) return { x: 0, y: 0 };

    const baseY = 60;
    const fieldsHeight = (node.fields?.length || 0) * 18;

    if (node.type === 'start') {
      return { x: node.x + 80, y: node.y + 30 };
    }

    if (node.type === 'end') {
      return { x: node.x, y: node.y + 30 };
    }

    if (!methodName || !node.methods) {
      const centerY = node.y + baseY + fieldsHeight + ((node.methods?.length || 0) * 18) / 2;
      return {
        x: node.x + (isSource ? 200 : 0),
        y: centerY,
      };
    }

    const methodIndex = node.methods.findIndex((m) => m === methodName);
    if (methodIndex === -1) {
      const centerY = node.y + baseY + fieldsHeight + ((node.methods?.length || 0) * 18) / 2;
      return {
        x: node.x + (isSource ? 200 : 0),
        y: centerY,
      };
    }

    const methodY = node.y + baseY + fieldsHeight + methodIndex * 18 - 5;
    return {
      x: node.x + (isSource ? 200 : 0),
      y: methodY,
    };
  };

  const rectIntersectsLine = (rect: { x: number; y: number; width: number; height: number }, x1: number, y1: number, x2: number, y2: number) => {
    const { x, y, width, height } = rect;
    const margin = 15;
    const rx = x - margin;
    const ry = y - margin;
    const rw = width + margin * 2;
    const rh = height + margin * 2;

    if ((x1 > rx && x1 < rx + rw && y1 > ry && y1 < ry + rh) || (x2 > rx && x2 < rx + rw && y2 > ry && y2 < ry + rh)) {
      return true;
    }

    const edges: [number, number, number, number][] = [
      [rx, ry, rx + rw, ry],
      [rx + rw, ry, rx + rw, ry + rh],
      [rx, ry + rh, rx + rw, ry + rh],
      [rx, ry, rx, ry + rh],
    ];

    return edges.some(([ex1, ey1, ex2, ey2]) => lineSegmentsIntersect(x1, y1, x2, y2, ex1, ey1, ex2, ey2));
  };

  const lineSegmentsIntersect = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number) => {
    const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
    if (denom === 0) return false;

    const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
    const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;

    return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
  };

  const findOptimalPath = (startX: number, startY: number, endX: number, endY: number, obstacles: { x: number; y: number; width: number; height: number }[]) => {
    const ROUTING_MARGIN = 40;
    const CORNER_RADIUS = 12;

    const directPathClear = !obstacles.some((obs) => rectIntersectsLine(obs, startX, startY, endX, endY));

    if (directPathClear) {
      const dx = endX - startX;
      const controlOffset = Math.min(Math.abs(dx) * 0.4, 100);
      return {
        path: `M ${startX} ${startY} C ${startX + controlOffset} ${startY}, ${endX - controlOffset} ${endY}, ${endX} ${endY}`,
        type: 'direct' as const,
        endX,
        endY,
      };
    }

    const goingRight = endX > startX;

    const relevantObstacles = obstacles.filter((obs) => {
      const inXRange = goingRight ? obs.x < endX && obs.x + obs.width > startX : obs.x + obs.width > endX && obs.x < startX;
      return inXRange;
    });

    if (relevantObstacles.length === 0) {
      const controlOffset = Math.abs(endX - startX) * 0.4;
      return {
        path: `M ${startX} ${startY} C ${startX + controlOffset} ${startY}, ${endX - controlOffset} ${endY}, ${endX} ${endY}`,
        type: 'direct' as const,
        endX,
        endY,
      };
    }

    const waypoints: { x: number; y: number }[] = [];

    const minObsY = Math.min(...relevantObstacles.map((o) => o.y));
    const maxObsY = Math.max(...relevantObstacles.map((o) => o.y + o.height));

    const spaceAbove = minObsY;
    const spaceBelow = 800 - maxObsY;

    let routeAbove = true;
    if (startY < minObsY && endY < minObsY) {
      routeAbove = true;
    } else if (startY > maxObsY && endY > maxObsY) {
      routeAbove = false;
    } else {
      routeAbove = spaceAbove > spaceBelow;
    }

    const routeY = routeAbove ? minObsY - ROUTING_MARGIN : maxObsY + ROUTING_MARGIN;

    waypoints.push({ x: startX, y: startY });
    const exitX = startX + 30;
    waypoints.push({ x: exitX, y: startY });
    waypoints.push({ x: exitX, y: routeY });
    const entryX = endX - 30;
    waypoints.push({ x: entryX, y: routeY });
    waypoints.push({ x: entryX, y: endY });
    waypoints.push({ x: endX, y: endY });

    let pathData = `M ${waypoints[0].x} ${waypoints[0].y}`;

    for (let i = 1; i < waypoints.length; i += 1) {
      const prev = waypoints[i - 1];
      const curr = waypoints[i];
      const next = waypoints[i + 1];

      if (!next) {
        pathData += ` L ${curr.x} ${curr.y}`;
      } else {
        const dx1 = curr.x - prev.x;
        const dy1 = curr.y - prev.y;
        const dx2 = next.x - curr.x;
        const dy2 = next.y - curr.y;

        const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
        const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

        const radius = Math.min(CORNER_RADIUS, len1 / 2, len2 / 2);

        if (len1 > radius && len2 > radius) {
          const offsetX1 = (dx1 / len1) * radius;
          const offsetY1 = (dy1 / len1) * radius;
          const offsetX2 = (dx2 / len2) * radius;
          const offsetY2 = (dy2 / len2) * radius;

          const cornerStart = {
            x: curr.x - offsetX1,
            y: curr.y - offsetY1,
          };
          const cornerEnd = {
            x: curr.x + offsetX2,
            y: curr.y + offsetY2,
          };

          pathData += ` L ${cornerStart.x} ${cornerStart.y}`;
          pathData += ` Q ${curr.x} ${curr.y}, ${cornerEnd.x} ${cornerEnd.y}`;
        } else {
          pathData += ` L ${curr.x} ${curr.y}`;
        }
      }
    }

    return {
      path: pathData,
      type: 'routed' as const,
      routeY,
      endX,
      endY,
    };
  };

  const renderConnection = (conn: WorkflowConnection, index: number) => {
    const fromNode = getNodeById(conn.from);
    const toNode = getNodeById(conn.to);

    if (!fromNode || !toNode || fromNode.x === undefined || toNode.x === undefined) return null;

    if (highlightMode && selectedNode && conn.from !== selectedNode && conn.to !== selectedNode) {
      return null;
    }

    const start = getMethodPosition(conn.from, conn.fromMethod, true);
    const end = getMethodPosition(conn.to, conn.toMethod, false);

    const obstacles = nodes
      .filter((n) => n.id !== conn.from && n.id !== conn.to && n.x !== undefined && n.y !== undefined)
      .map((n) => getNodeBounds(n as WorkflowNode & { x: number; y: number }));

    const pathInfo = findOptimalPath(start.x, start.y, end.x, end.y, obstacles);

    let labelX: number;
    let labelY: number;
    if (pathInfo.type === 'direct') {
      labelX = (start.x + pathInfo.endX) / 2;
      labelY = (start.y + pathInfo.endY) / 2 - 10;
    } else {
      labelX = (start.x + pathInfo.endX) / 2;
      labelY = (pathInfo.routeY ?? start.y) - 12;
    }

    const isHighlighted = highlightMode && selectedNode && (conn.from === selectedNode || conn.to === selectedNode);

    return (
      <g key={`${conn.from}-${conn.to}-${index}`}>
        <path
          d={pathInfo.path}
          fill="none"
          stroke={isHighlighted ? '#3B82F6' : '#94A3B8'}
          strokeWidth={isHighlighted ? 3 : 2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={highlightMode && !isHighlighted ? 0.2 : 1}
          style={{ filter: 'drop-shadow(0px 1px 2px rgba(0, 0, 0, 0.1))' }}
        />
        {showLabels && (
          <>
            <rect
              x={labelX - 35}
              y={labelY - 11}
              width={70}
              height={20}
              fill="white"
              rx={6}
              stroke="#E2E8F0"
              strokeWidth={1}
              opacity={highlightMode && !isHighlighted ? 0.3 : 1}
            />
            <text
              x={labelX}
              y={labelY + 4}
              fontSize={11}
              fill="#475569"
              textAnchor="middle"
              className="select-none"
              fontWeight={500}
              opacity={highlightMode && !isHighlighted ? 0.3 : 1}
            >
              {conn.label}
            </text>
          </>
        )}
      </g>
    );
  };

  const renderNode = (node: WorkflowNode & { x?: number; y?: number }) => {
    const isSelected = selectedNode === node.id;

    if (node.x === undefined || node.y === undefined) {
      return null;
    }

    if (node.type === 'start') {
      return (
        <g key={node.id} transform={`translate(${node.x}, ${node.y})`} data-node-interactive="true">
          <rect
            width={80}
            height={60}
            rx={8}
            fill="white"
            stroke="#E2E8F0"
            strokeWidth={1.5}
            className="cursor-pointer"
            onClick={() => setSelectedNode(node.id)}
            style={{ filter: 'drop-shadow(0px 2px 4px rgba(0, 0, 0, 0.06))' }}
          />
          <circle cx={20} cy={20} r={10} fill="#D1FAE5" />
          <text x={20} y={24} fontSize={14} fill="#059669" textAnchor="middle" fontWeight={500}>
            ▶
          </text>
          <text x={40} y={35} fontSize={13} fill="#334155" fontWeight={500}>
            {node.label}
          </text>
        </g>
      );
    }

    if (node.type === 'end') {
      return (
        <g key={node.id} transform={`translate(${node.x}, ${node.y})`} data-node-interactive="true">
          <rect
            width={80}
            height={60}
            rx={8}
            fill="white"
            stroke="#E2E8F0"
            strokeWidth={1.5}
            className="cursor-pointer"
            onClick={() => setSelectedNode(node.id)}
            style={{ filter: 'drop-shadow(0px 2px 4px rgba(0, 0, 0, 0.06))' }}
          />
          <rect x={15} y={15} width={14} height={14} rx={2} fill="#E0E7FF" stroke="#6366F1" strokeWidth={1.5} />
          <text x={40} y={40} fontSize={13} fill="#334155" fontWeight={500}>
            {node.label}
          </text>
        </g>
      );
    }

    const nodeHeight = 40 + (node.fields?.length || 0) * 18 + (node.methods?.length || 0) * 18 + 10;

    return (
      <g key={node.id} transform={`translate(${node.x}, ${node.y})`} data-node-interactive="true">
        <rect
          width={200}
          height={nodeHeight}
          rx={12}
          fill="white"
          stroke={isSelected ? '#3B82F6' : '#E2E8F0'}
          strokeWidth={isSelected ? 2.5 : 1.5}
          className="cursor-pointer"
          onClick={() => setSelectedNode(node.id)}
          style={{ filter: 'drop-shadow(0px 2px 8px rgba(0, 0, 0, 0.08))' }}
        />

        <circle cx={20} cy={20} r={12} fill="#FEF3C7" />
        <text x={20} y={24} fontSize={14} textAnchor="middle">
          📦
        </text>

        <text x={40} y={25} fontSize={14} fill="#1E293B" fontWeight={600}>
          {node.label}
        </text>

        <text x={40} y={38} fontSize={10} fill="#94A3B8">
          {node.file}
        </text>

        <line x1={10} y1={45} x2={190} y2={45} stroke="#E2E8F0" strokeWidth={1} />

        {node.fields?.map((field, i) => (
          <text key={`field-${i}`} x={20} y={60 + i * 18} fontSize={11} fill="#64748B">
            <tspan fill="#8B5CF6" fontWeight={500}>
              ●
            </tspan>{' '}
            {field}
          </text>
        ))}

        {node.methods?.map((method, i) => {
          const hasOutgoing = connections.some((c) => c.from === node.id && c.fromMethod === method);
          const hasIncoming = connections.some((c) => c.to === node.id && c.toMethod === method);
          const methodY = 60 + (node.fields?.length || 0) * 18 + i * 18;

          return (
            <g key={`method-${i}`}>
              <text x={20} y={methodY} fontSize={11} fill="#334155">
                <tspan fill="#3B82F6" fontWeight={500}>
                  ▸
                </tspan>{' '}
                {method}
              </text>
              {hasOutgoing && <circle cx={200} cy={methodY - 5} r={4} fill="#3B82F6" />}
              {hasIncoming && <circle cx={0} cy={methodY - 5} r={4} fill="#38BDF8" />}
            </g>
          );
        })}
      </g>
    );
  };

  const getCanvasCenterPoint = () => {
    if (!canvasWrapperRef.current) return null;
    const rect = canvasWrapperRef.current.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  };

  const getSvgPoint = (clientX: number, clientY: number) => {
    if (!svgRef.current) {
      return { x: clientX, y: clientY };
    }

    const point = svgRef.current.createSVGPoint();
    point.x = clientX;
    point.y = clientY;

    const ctm = svgRef.current.getScreenCTM();
    if (!ctm) {
      return { x: clientX, y: clientY };
    }

    const inverted = ctm.inverse();
    const svgPoint = point.matrixTransform(inverted);
    return { x: svgPoint.x, y: svgPoint.y };
  };

  const zoomToPoint = (scaleFactor: number, point?: { x: number; y: number }) => {
    const referencePoint = point ?? getCanvasCenterPoint();
    setViewTransform((prev) => {
      const nextScale = clampScale(prev.scale * scaleFactor);
      if (!svgRef.current || !referencePoint) {
        return { ...prev, scale: nextScale };
      }

      const svgPoint = getSvgPoint(referencePoint.x, referencePoint.y);
      const graphPoint = {
        x: (svgPoint.x - prev.x) / prev.scale,
        y: (svgPoint.y - prev.y) / prev.scale,
      };

      return {
        scale: nextScale,
        x: svgPoint.x - graphPoint.x * nextScale,
        y: svgPoint.y - graphPoint.y * nextScale,
      };
    });
  };

  const handleWheel = (event: ReactWheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const scaleFactor = event.deltaY < 0 ? 1.1 : 0.9;
    zoomToPoint(scaleFactor, { x: event.clientX, y: event.clientY });
  };

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if ((event.target as HTMLElement)?.closest('[data-node-interactive="true"]')) {
      return;
    }

    setIsPanning(true);
    panStartRef.current = { x: event.clientX, y: event.clientY };
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!isPanning || !panStartRef.current) return;

    const dx = event.clientX - panStartRef.current.x;
    const dy = event.clientY - panStartRef.current.y;
    panStartRef.current = { x: event.clientX, y: event.clientY };
    setViewTransform((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
  };

  const endPan = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (isPanning) {
      setIsPanning(false);
    }
    panStartRef.current = null;

    if (svgRef.current?.hasPointerCapture(event.pointerId)) {
      svgRef.current.releasePointerCapture(event.pointerId);
    }
  };

  const handleResetView = () => {
    setViewTransform({ scale: 1, x: 0, y: 0 });
  };

  const handleZoomIn = () => zoomToPoint(1.15);
  const handleZoomOut = () => zoomToPoint(0.85);

  const handleZoomToFit = useCallback(() => {
    if (!canvasWrapperRef.current || nodes.length === 0) return;
    const positionedNodes = nodes.filter((node): node is WorkflowNode & { x: number; y: number } =>
      typeof node.x === 'number' && typeof node.y === 'number',
    );

    if (!positionedNodes.length) return;

    const bounds = positionedNodes.map((node) => getNodeBounds(node));
    const minX = Math.min(...bounds.map((b) => b.x));
    const minY = Math.min(...bounds.map((b) => b.y));
    const maxX = Math.max(...bounds.map((b) => b.x + b.width));
    const maxY = Math.max(...bounds.map((b) => b.y + b.height));
    const contentWidth = maxX - minX || 1;
    const contentHeight = maxY - minY || 1;
    const padding = 160;
    const rect = canvasWrapperRef.current.getBoundingClientRect();

    const scaleX = (rect.width - padding) / contentWidth;
    const scaleY = (rect.height - padding) / contentHeight;
    const nextScale = clampScale(Math.min(scaleX, scaleY));
    const centerX = minX + contentWidth / 2;
    const centerY = minY + contentHeight / 2;

    setViewTransform({
      scale: Number.isFinite(nextScale) ? nextScale : 1,
      x: rect.width / 2 - centerX * (Number.isFinite(nextScale) ? nextScale : 1),
      y: rect.height / 2 - centerY * (Number.isFinite(nextScale) ? nextScale : 1),
    });
  }, [nodes, getNodeBounds]);

  useEffect(() => {
    if (!nodes.length) return;
    const frame = requestAnimationFrame(() => {
      handleZoomToFit();
    });

    return () => cancelAnimationFrame(frame);
  }, [nodes, handleZoomToFit]);

  return (
    <div className="app-frame">
      <div className="app-shell">
        <header className="app-header">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Workflow</p>
            <h1 className="text-2xl font-semibold text-slate-900">Python Class Visualizer</h1>
            <p className="text-sm text-slate-500 max-w-3xl">
              Map Python classes, inspect relationships, and navigate large modules with a responsive diagram workspace.
            </p>
          </div>
          <div className="app-status-group">
            {pyodide ? (
              <span className="status-pill success">Parser Ready</span>
            ) : (
              <span className="status-pill">Load code to enable parsing</span>
            )}
            <span className="status-pill">{Math.round(viewTransform.scale * 100)}% zoom</span>
            {highlightMode && <span className="status-pill info">Focus Mode</span>}
          </div>
        </header>

        <section className="control-panel">
          <div className="control-grid">
            <div className="control-section">
              <div className="control-heading">
                <span className="control-label">Source</span>
                <p className="control-description">Load or refresh the workflow data.</p>
              </div>
              <div className="control-actions">
                <button
                  className="control-button primary"
                  onClick={() => parsePythonCode(pythonCode)}
                  disabled={isLoadingPyodide}
                >
                  <Play className="w-4 h-4" />
                  {isLoadingPyodide ? 'Loading Parser' : 'Run Parser'}
                </button>
                <button className="control-button secondary" onClick={() => setShowImportModal(true)}>
                  <Upload className="w-4 h-4" />
                  Import Code
                </button>
                <button className="control-button ghost" onClick={relayout}>
                  <RefreshCw className="w-4 h-4" />
                  Relayout
                </button>
              </div>
            </div>

            <div className="control-section">
              <div className="control-heading">
                <span className="control-label">Display</span>
                <p className="control-description">Toggle annotations and grouping.</p>
              </div>
              <div className="control-actions">
                <button
                  className={`control-toggle ${showLabels ? 'is-active' : ''}`}
                  onClick={() => setShowLabels((prev) => !prev)}
                >
                  <Eye className="w-4 h-4" />
                  Labels
                </button>
                <button
                  className={`control-toggle ${groupConnections ? 'is-active' : ''}`}
                  onClick={() => setGroupConnections((prev) => !prev)}
                >
                  <Code className="w-4 h-4" />
                  Group Connections
                </button>
                <button
                  className={`control-toggle ${highlightMode ? 'is-active' : ''}`}
                  onClick={() => setHighlightMode((prev) => !prev)}
                >
                  <Settings className="w-4 h-4" />
                  Focus Mode
                </button>
              </div>
            </div>

          </div>

          <div className="control-panel-footer">
            <div className="control-stats">
              <span>
                <strong>{nodes.length}</strong> nodes
              </span>
              <span>
                <strong>{connections.length}</strong> connections
              </span>
              {groupConnections && (
                <span>
                  <strong>{getDisplayConnections().length}</strong> grouped
                </span>
              )}
            </div>
            <div className="app-status-group">
              {pyodide && <span className="status-pill success">Parser Ready</span>}
              {highlightMode && <span className="status-pill info">Focus Mode</span>}
            </div>
          </div>
        </section>

        <div className="workspace-region">
          <div className="workspace-main">
            <div className="canvas-shell" ref={canvasWrapperRef}>
              <div className="canvas-grid-layer" />
              {parseStatus && !showImportModal && <div className="canvas-status">{parseStatus}</div>}
              <div className="canvas-viewport-stack">
                <button className="canvas-viewport-button" onClick={handleZoomOut} title="Zoom out">
                  <ZoomOut className="w-4 h-4" />
                </button>
                <button className="canvas-viewport-button" onClick={handleResetView} title="Reset view">
                  <Move className="w-4 h-4" />
                </button>
                <button className="canvas-viewport-button" onClick={handleZoomIn} title="Zoom in">
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button className="canvas-viewport-button" onClick={handleZoomToFit} title="Zoom to fit">
                  <Maximize2 className="w-4 h-4" />
                </button>
              </div>
              <svg
                ref={svgRef}
                className={`canvas-svg ${isPanning ? 'is-panning' : ''}`}
                onWheel={handleWheel}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={endPan}
                onPointerLeave={endPan}
                onPointerCancel={endPan}
              >
                <g transform={`translate(${viewTransform.x} ${viewTransform.y}) scale(${viewTransform.scale})`}>
                  {getDisplayConnections().map((conn, i) => renderConnection(conn, i))}
                  {nodes.map((node) => renderNode(node))}
                </g>
              </svg>
              <div className="canvas-readout">
                <span>{Math.round(viewTransform.scale * 100)}% zoom</span>
                <span>
                  pan {Math.round(viewTransform.x)}px, {Math.round(viewTransform.y)}px
                </span>
              </div>
            </div>
          </div>
        </div>

      {showImportModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-slate-900">Import Python Code</h2>
              <button onClick={() => setShowImportModal(false)} className="text-slate-400 hover:text-slate-600">
                ×
              </button>
            </div>

            <div className="p-6 flex-1 overflow-auto">
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 mb-2">Upload Python File</label>
                <input
                  type="file"
                  accept=".py"
                  onChange={handleFileUpload}
                  className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 mb-2">Or Paste Python Code</label>
                <textarea
                  value={pythonCode}
                  onChange={(e) => setPythonCode(e.target.value)}
                  placeholder={'class UserService:\n    def __init__(self):\n        self.database = Database()\n    def get_user(self):\n        return self.database.query()\n\nclass Database:\n    def query(self):\n        return "data"'}
                  className="w-full h-64 px-3 py-2 border border-slate-300 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {parseStatus && (
                <div
                  className={`p-3 rounded-lg text-sm ${
                    parseStatus.startsWith('✓')
                      ? 'bg-green-50 text-green-700'
                      : parseStatus.startsWith('⚠')
                        ? 'bg-yellow-50 text-yellow-700'
                        : parseStatus.startsWith('✗')
                          ? 'bg-red-50 text-red-700'
                          : 'bg-blue-50 text-blue-700'
                  }`}
                >
                  {parseStatus}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
              <button onClick={() => setShowImportModal(false)} className="px-4 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50">
                Cancel
              </button>
              <button
                onClick={() => parsePythonCode(pythonCode)}
                disabled={!pythonCode || isLoadingPyodide}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
              >
                {isLoadingPyodide ? 'Loading Parser...' : 'Parse Code'}
              </button>
            </div>
          </div>
        </div>
      )}

        <footer className="workspace-footer">
          <div className="flex items-center gap-4 text-sm text-slate-600">
            <div className="flex items-center gap-2">
              <span className="font-medium">{nodes.length}</span> nodes
              <span className="mx-1">•</span>
              <span className="font-medium">{connections.length}</span> connections
              {groupConnections && (
                <>
                  <span className="mx-1">•</span>
                  <span className="text-blue-600 font-medium">{getDisplayConnections().length} grouped</span>
                </>
              )}
            </div>
            {pyodide && <span className="text-green-600">● Parser Ready</span>}
            {highlightMode && <span className="text-blue-600">● Focus Mode</span>}
          </div>
          <div className="flex items-center gap-3">
            <button className="p-2 hover:bg-slate-100 rounded-lg" title="Zoom to fit" onClick={handleZoomToFit}>
              <Eye className="w-4 h-4" />
            </button>
            <button className="p-2 hover:bg-slate-100 rounded-lg" title="View code">
              <FileCode className="w-4 h-4" />
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default CodeWorkflowVisualizer;
