import React, { useState, useEffect } from 'react';
import { Play, Settings, Code, Eye, MoreHorizontal, Plus, Trash2, RefreshCw, Upload, FileCode } from 'lucide-react';

const CodeWorkflowVisualizer = () => {
  const [selectedNode, setSelectedNode] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [connections, setConnections] = useState([]);
  const [showImportModal, setShowImportModal] = useState(false);
  const [pythonCode, setPythonCode] = useState('');
  const [parseStatus, setParseStatus] = useState('');
  const [pyodide, setPyodide] = useState(null);
  const [isLoadingPyodide, setIsLoadingPyodide] = useState(false);
  
  // Visualization options
  const [showLabels, setShowLabels] = useState(true);
  const [groupConnections, setGroupConnections] = useState(false);
  const [highlightMode, setHighlightMode] = useState(false);

  useEffect(() => {
    loadSampleData();
    
    // Load Pyodide script dynamically
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/pyodide/v0.24.1/full/pyodide.js';
    script.async = true;
    document.body.appendChild(script);
    
    return () => {
      // Cleanup
      if (document.body.contains(script)) {
        document.body.removeChild(script);
      }
    };
  }, []);

  const loadPyodide = async () => {
    if (pyodide) return pyodide;
    
    setIsLoadingPyodide(true);
    setParseStatus('Loading Python parser... (first time only, ~10MB)');
    
    try {
      const pyodideInstance = await window.loadPyodide({
        indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.24.1/full/'
      });
      
      setPyodide(pyodideInstance);
      setParseStatus('✓ Python parser loaded successfully!');
      setIsLoadingPyodide(false);
      return pyodideInstance;
    } catch (error) {
      setParseStatus(`✗ Failed to load parser: ${error.message}`);
      setIsLoadingPyodide(false);
      return null;
    }
  };

  const loadSampleData = () => {
    const sampleNodes = [
      {
        id: 'start',
        type: 'start',
        label: 'Main',
        file: 'main.py'
      },
      {
        id: 'auth',
        type: 'class',
        label: 'AuthService',
        file: 'auth.py',
        fields: ['api_key', 'session'],
        methods: ['login()', 'validate()', 'logout()']
      },
      {
        id: 'user',
        type: 'class',
        label: 'UserController',
        file: 'user.py',
        fields: ['db_connection', 'cache'],
        methods: ['getUser()', 'updateUser()', 'deleteUser()']
      }
    ];

    const sampleConnections = [
      { from: 'start', to: 'auth', toMethod: 'login()', label: 'authenticate' },
      { from: 'start', to: 'user', toMethod: 'getUser()', label: 'processRequest' }
    ];

    const positioned = autoLayout(sampleNodes, sampleConnections);
    setNodes(positioned);
    setConnections(sampleConnections);
  };

  // PYTHON AST PARSER
  const parsePythonCode = async (code) => {
    setParseStatus('Initializing Python parser...');
    
    try {
      const pyodideInstance = await loadPyodide();
      if (!pyodideInstance) return;
      
      setParseStatus('Analyzing code structure...');
      
      // Python script that uses AST to parse the code
      const parserScript = `
import ast
import json

def parse_python_code(code):
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return {"error": f"Syntax error: {str(e)}"}
    
    classes = {}
    
    # First pass: collect all classes and their methods
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            class_name = node.name
            classes[class_name] = {
                "name": class_name,
                "fields": set(),
                "methods": [],
                "method_calls": {}
            }
            
            # Find all methods in this class
            for item in node.body:
                if isinstance(item, ast.FunctionDef):
                    method_name = item.name
                    if method_name != '__init__':
                        classes[class_name]["methods"].append(method_name + "()")
                    
                    # Find field assignments (self.field = ...)
                    for stmt in ast.walk(item):
                        if isinstance(stmt, ast.Assign):
                            for target in stmt.targets:
                                if isinstance(target, ast.Attribute):
                                    if isinstance(target.value, ast.Name) and target.value.id == 'self':
                                        classes[class_name]["fields"].add(target.attr)
                    
                    # Track method calls
                    classes[class_name]["method_calls"][method_name] = []
                    
                    # Find all function calls in this method
                    for stmt in ast.walk(item):
                        if isinstance(stmt, ast.Call):
                            call_info = None
                            
                            # Case 1: self.method()
                            if isinstance(stmt.func, ast.Attribute):
                                if isinstance(stmt.func.value, ast.Name) and stmt.func.value.id == 'self':
                                    call_info = {
                                        "type": "self",
                                        "target": class_name,
                                        "method": stmt.func.attr + "()"
                                    }
                                
                                # Case 2: self.attribute.method() (e.g., self.db.query())
                                elif isinstance(stmt.func.value, ast.Attribute):
                                    if isinstance(stmt.func.value.value, ast.Name) and stmt.func.value.value.id == 'self':
                                        attr_name = stmt.func.value.attr
                                        method_name_called = stmt.func.attr
                                        call_info = {
                                            "type": "attribute",
                                            "attribute": attr_name,
                                            "method": method_name_called + "()"
                                        }
                                
                                # Case 3: ClassName.method()
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
    
    # Second pass: resolve attribute calls to actual classes
    # Build a map of self.attribute -> ClassName
    attr_to_class = {}
    
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            class_name = node.name
            for item in node.body:
                if isinstance(item, ast.FunctionDef):
                    for stmt in ast.walk(item):
                        # Look for self.attr = ClassName()
                        if isinstance(stmt, ast.Assign):
                            for target in stmt.targets:
                                if isinstance(target, ast.Attribute):
                                    if isinstance(target.value, ast.Name) and target.value.id == 'self':
                                        attr_name = target.attr
                                        # Check if value is a class instantiation
                                        if isinstance(stmt.value, ast.Call):
                                            if isinstance(stmt.value.func, ast.Name):
                                                target_class = stmt.value.func.id
                                                if target_class in classes:
                                                    key = f"{class_name}.{attr_name}"
                                                    attr_to_class[key] = target_class
    
    # Third pass: resolve attribute method calls
    for class_name, class_data in classes.items():
        for method_name, calls in class_data["method_calls"].items():
            for i, call in enumerate(calls):
                if call["type"] == "attribute":
                    attr_name = call["attribute"]
                    key = f"{class_name}.{attr_name}"
                    
                    # Try to find the target class
                    if key in attr_to_class:
                        call["target"] = attr_to_class[key]
                    else:
                        # Fallback: match by name similarity
                        for target_class in classes.keys():
                            if attr_name.lower() in target_class.lower() or target_class.lower() in attr_name.lower():
                                call["target"] = target_class
                                break
    
    # Convert sets to lists for JSON
    for class_data in classes.values():
        class_data["fields"] = list(class_data["fields"])
    
    return {"classes": classes}

# Make function available
parse_result = parse_python_code
`;
      
      // Load the parser script
      await pyodideInstance.runPythonAsync(parserScript);
      
      // Parse the user's code
      const result = await pyodideInstance.runPythonAsync(`
import json
result = parse_result("""${code.replace(/"/g, '\\"').replace(/\n/g, '\\n')}""")
json.dumps(result)
`);
      
      const parseResult = JSON.parse(result);
      
      if (parseResult.error) {
        setParseStatus(`✗ ${parseResult.error}`);
        return;
      }
      
      const classes = parseResult.classes;
      
      // Convert to nodes and connections
      const parsedNodes = [];
      const parsedConnections = [];
      let nodeId = 1;
      const classToId = {};
      
      // Add start node
      parsedNodes.push({
        id: 'start',
        type: 'start',
        label: 'Main',
        file: 'main.py'
      });
      
      // Add class nodes
      Object.keys(classes).forEach(className => {
        const classData = classes[className];
        const id = `class_${nodeId++}`;
        classToId[className] = id;
        
        parsedNodes.push({
          id: id,
          type: 'class',
          label: className,
          file: `${className.toLowerCase()}.py`,
          fields: classData.fields,
          methods: classData.methods
        });
      });
      
      // Add end node
      parsedNodes.push({
        id: 'end',
        type: 'end',
        label: 'Return',
        file: 'return'
      });
      
      // Create connections
      Object.keys(classes).forEach(className => {
        const classData = classes[className];
        const sourceId = classToId[className];
        
        Object.keys(classData.method_calls).forEach(methodName => {
          const calls = classData.method_calls[methodName];
          
          calls.forEach(call => {
            if (call.target && classToId[call.target]) {
              const targetId = classToId[call.target];
              
              if (sourceId !== targetId) {
                const targetNode = parsedNodes.find(n => n.id === targetId);
                const methodExists = targetNode && targetNode.methods && targetNode.methods.includes(call.method);
                
                if (methodExists) {
                  const exists = parsedConnections.some(
                    c => c.from === sourceId && c.to === targetId && 
                         c.fromMethod === methodName + '()' && c.toMethod === call.method
                  );
                  
                  if (!exists) {
                    parsedConnections.push({
                      from: sourceId,
                      fromMethod: methodName + '()',
                      to: targetId,
                      toMethod: call.method,
                      label: call.method.replace('()', '')
                    });
                  }
                }
              }
            }
          });
        });
      });
      
      // Add connection from start to first class
      const firstClassId = Object.values(classToId)[0];
      if (firstClassId) {
        const node = parsedNodes.find(n => n.id === firstClassId);
        if (node && node.methods && node.methods.length > 0) {
          parsedConnections.push({
            from: 'start',
            to: firstClassId,
            toMethod: node.methods[0],
            label: 'call'
          });
        }
      }
      
      if (parsedNodes.length > 2) {
        const positioned = autoLayout(parsedNodes, parsedConnections);
        setNodes(positioned);
        setConnections(parsedConnections);
        
        const classCount = Object.keys(classes).length;
        const methodCount = Object.values(classes).reduce((sum, c) => sum + c.methods.length, 0);
        
        // Debug: Log what was found
        console.log('=== PARSED CLASSES ===');
        Object.keys(classes).forEach(className => {
          console.log(`${className}:`, classes[className]);
        });
        console.log('=== CONNECTIONS ===');
        console.log(parsedConnections);
        
        setParseStatus(`✓ Parsed ${classCount} classes, ${methodCount} methods, ${parsedConnections.length} connections`);
        setTimeout(() => setShowImportModal(false), 2000);
      } else {
        setParseStatus('⚠ No classes found. Please check your Python code.');
      }
      
    } catch (error) {
      setParseStatus(`✗ Error: ${error.message}`);
    }
  };

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target.result;
        setPythonCode(content);
        setParseStatus('File loaded. Click "Parse Code" to visualize.');
      };
      reader.readAsText(file);
    }
  };

  // AUTO-LAYOUT ALGORITHM
  const autoLayout = (nodesList, connectionsList) => {
    const graph = {};
    const inDegree = {};
    
    nodesList.forEach(node => {
      graph[node.id] = [];
      inDegree[node.id] = 0;
    });
    
    connectionsList.forEach(conn => {
      if (graph[conn.from] && !graph[conn.from].includes(conn.to)) {
        graph[conn.from].push(conn.to);
        inDegree[conn.to]++;
      }
    });
    
    const layers = [];
    const nodeLayer = {};
    const queue = [];
    
    Object.keys(inDegree).forEach(nodeId => {
      if (inDegree[nodeId] === 0) {
        queue.push(nodeId);
        nodeLayer[nodeId] = 0;
      }
    });
    
    while (queue.length > 0) {
      const current = queue.shift();
      const currentLayer = nodeLayer[current];
      
      if (!layers[currentLayer]) {
        layers[currentLayer] = [];
      }
      layers[currentLayer].push(current);
      
      (graph[current] || []).forEach(child => {
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
    
    const positionedNodes = nodesList.map(node => {
      const layer = nodeLayer[node.id] !== undefined ? nodeLayer[node.id] : 0;
      const nodesInLayer = layers[layer] || [];
      const indexInLayer = nodesInLayer.indexOf(node.id);
      
      let nodeHeight = NODE_HEIGHT_BASE;
      if (node.type === 'class') {
        nodeHeight = 40 + (node.fields?.length || 0) * 18 + (node.methods?.length || 0) * 18 + 10;
      } else if (node.type === 'start' || node.type === 'end') {
        nodeHeight = 60;
      }
      
      let yOffset = START_Y;
      for (let i = 0; i < indexInLayer; i++) {
        const prevNode = nodesList.find(n => n.id === nodesInLayer[i]);
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
        y: yOffset
      };
    });
    
    return positionedNodes;
  };

  const relayout = () => {
    const positioned = autoLayout(nodes, connections);
    setNodes(positioned);
  };
  
  const getDisplayConnections = () => {
    if (!groupConnections) return connections;
    
    // Group multiple connections between same two nodes
    const grouped = {};
    
    connections.forEach(conn => {
      const key = `${conn.from}-${conn.to}`;
      if (!grouped[key]) {
        grouped[key] = {
          ...conn,
          count: 1,
          methods: [conn.toMethod]
        };
      } else {
        grouped[key].count++;
        grouped[key].methods.push(conn.toMethod);
        grouped[key].label = `${grouped[key].count} calls`;
        // Clear specific method references for grouped view
        grouped[key].fromMethod = undefined;
        grouped[key].toMethod = undefined;
      }
    });
    
    return Object.values(grouped);
  };

  const deleteNode = (nodeId) => {
    const updatedNodes = nodes.filter(n => n.id !== nodeId);
    const updatedConnections = connections.filter(c => c.from !== nodeId && c.to !== nodeId);
    const positioned = autoLayout(updatedNodes, updatedConnections);
    setNodes(positioned);
    setConnections(updatedConnections);
    setSelectedNode(null);
  };

  const getNodeById = (nodeId) => {
    return nodes.find(n => n.id === nodeId);
  };

  const getNodeBounds = (node) => {
    if (node.type === 'start' || node.type === 'end') {
      return {
        x: node.x,
        y: node.y,
        width: 80,
        height: 60
      };
    }

    const nodeHeight = 40 + (node.fields?.length || 0) * 18 + (node.methods?.length || 0) * 18 + 10;
    return {
      x: node.x,
      y: node.y,
      width: 200,
      height: nodeHeight
    };
  };

  const getMethodPosition = (nodeId, methodName, isSource = true) => {
    const node = getNodeById(nodeId);
    if (!node) return { x: 0, y: 0 };

    const baseY = 60;
    const fieldsHeight = (node.fields?.length || 0) * 18;
    
    if (node.type === 'start') {
      return {
        x: node.x + 80,
        y: node.y + 30
      };
    }
    
    if (node.type === 'end') {
      return {
        x: node.x,
        y: node.y + 30
      };
    }

    if (!methodName || !node.methods) {
      const centerY = node.y + baseY + fieldsHeight + ((node.methods?.length || 0) * 18) / 2;
      return { 
        x: node.x + (isSource ? 200 : 0), 
        y: centerY
      };
    }

    const methodIndex = node.methods.findIndex(m => m === methodName);
    if (methodIndex === -1) {
      const centerY = node.y + baseY + fieldsHeight + ((node.methods?.length || 0) * 18) / 2;
      return { 
        x: node.x + (isSource ? 200 : 0), 
        y: centerY
      };
    }

    const methodY = node.y + baseY + fieldsHeight + methodIndex * 18 - 5;

    return {
      x: node.x + (isSource ? 200 : 0),
      y: methodY
    };
  };

  const rectIntersectsLine = (rect, x1, y1, x2, y2) => {
    const { x, y, width, height } = rect;
    
    const margin = 15;
    const rx = x - margin;
    const ry = y - margin;
    const rw = width + margin * 2;
    const rh = height + margin * 2;
    
    if ((x1 > rx && x1 < rx + rw && y1 > ry && y1 < ry + rh) ||
        (x2 > rx && x2 < rx + rw && y2 > ry && y2 < ry + rh)) {
      return true;
    }
    
    const edges = [
      [rx, ry, rx + rw, ry],
      [rx + rw, ry, rx + rw, ry + rh],
      [rx, ry + rh, rx + rw, ry + rh],
      [rx, ry, rx, ry + rh]
    ];
    
    for (const [ex1, ey1, ex2, ey2] of edges) {
      if (lineSegmentsIntersect(x1, y1, x2, y2, ex1, ey1, ex2, ey2)) {
        return true;
      }
    }
    
    return false;
  };

  const lineSegmentsIntersect = (x1, y1, x2, y2, x3, y3, x4, y4) => {
    const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
    if (denom === 0) return false;
    
    const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
    const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;
    
    return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
  };

  const findOptimalPath = (startX, startY, endX, endY, obstacles) => {
    const ROUTING_MARGIN = 40;
    const CORNER_RADIUS = 12;
    
    let directPathClear = true;
    for (const obs of obstacles) {
      if (rectIntersectsLine(obs, startX, startY, endX, endY)) {
        directPathClear = false;
        break;
      }
    }
    
    if (directPathClear) {
      const dx = endX - startX;
      const controlOffset = Math.min(Math.abs(dx) * 0.4, 100);
      return {
        path: `M ${startX} ${startY} C ${startX + controlOffset} ${startY}, ${endX - controlOffset} ${endY}, ${endX} ${endY}`,
        type: 'direct',
        endX: endX,
        endY: endY
      };
    }
    
    const goingRight = endX > startX;
    
    const relevantObstacles = obstacles.filter(obs => {
      const inXRange = goingRight ? 
        (obs.x < endX && obs.x + obs.width > startX) :
        (obs.x + obs.width > endX && obs.x < startX);
      return inXRange;
    });
    
    if (relevantObstacles.length === 0) {
      const controlOffset = Math.abs(endX - startX) * 0.4;
      return {
        path: `M ${startX} ${startY} C ${startX + controlOffset} ${startY}, ${endX - controlOffset} ${endY}, ${endX} ${endY}`,
        type: 'direct',
        endX: endX,
        endY: endY
      };
    }
    
    const waypoints = [];
    
    let routeAbove = true;
    
    const minObsY = Math.min(...relevantObstacles.map(o => o.y));
    const maxObsY = Math.max(...relevantObstacles.map(o => o.y + o.height));
    
    const spaceAbove = minObsY;
    const spaceBelow = 800 - maxObsY;
    
    if (startY < minObsY && endY < minObsY) {
      routeAbove = true;
    } else if (startY > maxObsY && endY > maxObsY) {
      routeAbove = false;
    } else {
      routeAbove = spaceAbove > spaceBelow;
    }
    
    const routeY = routeAbove ? 
      minObsY - ROUTING_MARGIN : 
      maxObsY + ROUTING_MARGIN;
    
    waypoints.push({ x: startX, y: startY });
    
    const exitX = startX + 30;
    waypoints.push({ x: exitX, y: startY });
    
    waypoints.push({ x: exitX, y: routeY });
    
    const entryX = endX - 30;
    waypoints.push({ x: entryX, y: routeY });
    
    waypoints.push({ x: entryX, y: endY });
    
    waypoints.push({ x: endX, y: endY });
    
    let pathData = `M ${waypoints[0].x} ${waypoints[0].y}`;
    
    for (let i = 1; i < waypoints.length; i++) {
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
            y: curr.y - offsetY1
          };
          const cornerEnd = {
            x: curr.x + offsetX2,
            y: curr.y + offsetY2
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
      type: 'routed',
      routeY: routeY,
      endX: endX,
      endY: endY
    };
  };

  const renderConnection = (conn, index) => {
    const fromNode = getNodeById(conn.from);
    const toNode = getNodeById(conn.to);
    
    if (!fromNode || !toNode) return null;

    // Highlight mode: only show connections related to selected node
    if (highlightMode && selectedNode) {
      if (conn.from !== selectedNode && conn.to !== selectedNode) {
        return null; // Hide this connection
      }
    }

    const start = getMethodPosition(conn.from, conn.fromMethod, true);
    const end = getMethodPosition(conn.to, conn.toMethod, false);
    
    const obstacles = nodes
      .filter(n => n.id !== conn.from && n.id !== conn.to)
      .map(n => getNodeBounds(n));
    
    const pathInfo = findOptimalPath(start.x, start.y, end.x, end.y, obstacles);
    
    let labelX, labelY;
    if (pathInfo.type === 'direct') {
      labelX = (start.x + pathInfo.endX) / 2;
      labelY = (start.y + pathInfo.endY) / 2 - 10;
    } else {
      labelX = (start.x + pathInfo.endX) / 2;
      labelY = pathInfo.routeY - 12;
    }
    
    // Determine if this connection is highlighted
    const isHighlighted = highlightMode && selectedNode && 
                         (conn.from === selectedNode || conn.to === selectedNode);
    
    return (
      <g key={index}>
        <path
          d={pathInfo.path}
          fill="none"
          stroke={isHighlighted ? "#3B82F6" : "#94A3B8"}
          strokeWidth={isHighlighted ? "3" : "2.5"}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={highlightMode && !isHighlighted ? 0.2 : 1}
          style={{
            filter: 'drop-shadow(0px 1px 2px rgba(0, 0, 0, 0.1))'
          }}
        />
        {showLabels && (
          <>
            <rect
              x={labelX - 35}
              y={labelY - 11}
              width={70}
              height={20}
              fill="white"
              rx="6"
              stroke="#E2E8F0"
              strokeWidth="1"
              opacity={highlightMode && !isHighlighted ? 0.3 : 1}
            />
            <text
              x={labelX}
              y={labelY + 4}
              fontSize="11"
              fill="#475569"
              textAnchor="middle"
              className="select-none"
              fontWeight="500"
              opacity={highlightMode && !isHighlighted ? 0.3 : 1}
            >
              {conn.label}
            </text>
          </>
        )}
      </g>
    );
  };

  const renderNode = (node) => {
    const isSelected = selectedNode === node.id;
    
    if (node.type === 'start') {
      return (
        <g key={node.id} transform={`translate(${node.x}, ${node.y})`}>
          <rect
            width="80"
            height="60"
            rx="8"
            fill="white"
            stroke="#E2E8F0"
            strokeWidth="1.5"
            className="cursor-pointer"
            onClick={() => setSelectedNode(node.id)}
            style={{ filter: 'drop-shadow(0px 2px 4px rgba(0, 0, 0, 0.06))' }}
          />
          <circle cx="20" cy="20" r="10" fill="#D1FAE5" />
          <text x="20" y="24" fontSize="14" fill="#059669" textAnchor="middle" fontWeight="500">▶</text>
          <text x="40" y="35" fontSize="13" fill="#334155" fontWeight="500">{node.label}</text>
        </g>
      );
    }
    
    if (node.type === 'end') {
      return (
        <g key={node.id} transform={`translate(${node.x}, ${node.y})`}>
          <rect
            width="80"
            height="60"
            rx="8"
            fill="white"
            stroke="#E2E8F0"
            strokeWidth="1.5"
            className="cursor-pointer"
            onClick={() => setSelectedNode(node.id)}
            style={{ filter: 'drop-shadow(0px 2px 4px rgba(0, 0, 0, 0.06))' }}
          />
          <rect x="15" y="15" width="14" height="14" rx="2" fill="#E0E7FF" stroke="#6366F1" strokeWidth="1.5" />
          <text x="40" y="40" fontSize="13" fill="#334155" fontWeight="500">{node.label}</text>
        </g>
      );
    }
    
    const nodeHeight = 40 + (node.fields?.length || 0) * 18 + (node.methods?.length || 0) * 18 + 10;
    
    return (
      <g key={node.id} transform={`translate(${node.x}, ${node.y})`}>
        <rect
          width="200"
          height={nodeHeight}
          rx="12"
          fill="white"
          stroke={isSelected ? '#3B82F6' : '#E2E8F0'}
          strokeWidth={isSelected ? '2.5' : '1.5'}
          className="cursor-pointer"
          onClick={() => setSelectedNode(node.id)}
          style={{ filter: 'drop-shadow(0px 2px 8px rgba(0, 0, 0, 0.08))' }}
        />
        
        <circle cx="20" cy="20" r="12" fill="#FEF3C7" />
        <text x="20" y="24" fontSize="14" textAnchor="middle">📦</text>
        
        <text x="40" y="25" fontSize="14" fill="#1E293B" fontWeight="600">{node.label}</text>
        
        <text x="40" y="38" fontSize="10" fill="#94A3B8">{node.file}</text>
        
        <line x1="10" y1="45" x2="190" y2="45" stroke="#E2E8F0" strokeWidth="1" />
        
        {node.fields && node.fields.map((field, i) => (
          <text key={`field-${i}`} x="20" y={60 + i * 18} fontSize="11" fill="#64748B">
            <tspan fill="#8B5CF6" fontWeight="500">●</tspan> {field}
          </text>
        ))}
        
        {node.methods && node.methods.map((method, i) => {
          const hasOutgoing = connections.some(c => c.from === node.id && c.fromMethod === method);
          const hasIncoming = connections.some(c => c.to === node.id && c.toMethod === method);
          const methodY = 60 + (node.fields?.length || 0) * 18 + i * 18;
          
          return (
            <g key={`method-${i}`}>
              <text x="20" y={methodY} fontSize="11" fill="#334155">
                <tspan fill="#3B82F6" fontWeight="500">▸</tspan> {method}
              </text>
              {hasOutgoing && (
                <circle 
                  cx="200" 
                  cy={methodY - 5} 
                  r="4" 
                  fill="#3B82F6"
                  stroke="white"
                  strokeWidth="1.5"
                />
              )}
              {hasIncoming && (
                <circle 
                  cx="0" 
                  cy={methodY - 5} 
                  r="4" 
                  fill="#10B981"
                  stroke="white"
                  strokeWidth="1.5"
                />
              )}
            </g>
          );
        })}
      </g>
    );
  };

  return (
    <div className="w-full h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex flex-col">
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button className="text-slate-600 hover:text-slate-900">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10 6L6 10l4 4V6z" />
            </svg>
          </button>
          <h1 className="text-lg font-semibold text-slate-900">Code Workflow</h1>
          <select className="text-sm bg-slate-100 border-none rounded px-2 py-1 text-slate-600">
            <option>Python (AST Parser)</option>
          </select>
        </div>
        
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setShowImportModal(true)}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
          >
            <FileCode size={16} />
            Import Python
          </button>
          
          {/* Visualization Controls */}
          <div className="flex items-center gap-2 border-l border-slate-200 pl-3">
            <button
              onClick={() => setShowLabels(!showLabels)}
              className={`px-3 py-1.5 text-sm rounded-lg flex items-center gap-2 ${
                showLabels 
                  ? 'bg-blue-100 text-blue-700 border border-blue-300' 
                  : 'border border-slate-300 hover:bg-slate-50'
              }`}
              title="Toggle connection labels"
            >
              <Eye size={16} />
              Labels
            </button>
            
            <button
              onClick={() => setGroupConnections(!groupConnections)}
              className={`px-3 py-1.5 text-sm rounded-lg flex items-center gap-2 ${
                groupConnections 
                  ? 'bg-blue-100 text-blue-700 border border-blue-300' 
                  : 'border border-slate-300 hover:bg-slate-50'
              }`}
              title="Group multiple connections"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M2 4h12v1H2V4zm0 3h12v1H2V7zm0 3h12v1H2v-1z"/>
              </svg>
              Group
            </button>
            
            <button
              onClick={() => {
                setHighlightMode(!highlightMode);
                if (!highlightMode) {
                  // When enabling highlight mode, show info
                  setParseStatus('💡 Click a node to highlight its connections');
                  setTimeout(() => setParseStatus(''), 3000);
                }
              }}
              className={`px-3 py-1.5 text-sm rounded-lg flex items-center gap-2 ${
                highlightMode 
                  ? 'bg-blue-100 text-blue-700 border border-blue-300' 
                  : 'border border-slate-300 hover:bg-slate-50'
              }`}
              title="Highlight mode: click nodes to see their connections"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 3l3 3-3 3V3zm0 10l-3-3 3-3v6z"/>
              </svg>
              Focus
            </button>
          </div>
          
          <button 
            onClick={relayout}
            className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg hover:bg-slate-50 flex items-center gap-2"
          >
            <RefreshCw size={16} />
            Re-layout
          </button>
          {selectedNode && (
            <button 
              onClick={() => deleteNode(selectedNode)}
              className="px-3 py-1.5 text-sm border border-red-300 text-red-600 rounded-lg hover:bg-red-50 flex items-center gap-2"
            >
              <Trash2 size={16} />
              Delete
            </button>
          )}
          <button className="px-4 py-1.5 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-800">
            Export
          </button>
        </div>
      </div>

      {showImportModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-slate-900">Import Python Code</h2>
              <button 
                onClick={() => setShowImportModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="p-6 flex-1 overflow-auto">
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Upload Python File
                </label>
                <input 
                  type="file"
                  accept=".py"
                  onChange={handleFileUpload}
                  className="block w-full text-sm text-slate-500
                    file:mr-4 file:py-2 file:px-4
                    file:rounded-lg file:border-0
                    file:text-sm file:font-semibold
                    file:bg-blue-50 file:text-blue-700
                    hover:file:bg-blue-100"
                />
              </div>
              
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Or Paste Python Code
                </label>
                <textarea
                  value={pythonCode}
                  onChange={(e) => setPythonCode(e.target.value)}
                  placeholder="class UserService:&#10;    def __init__(self):&#10;        self.database = Database()&#10;    &#10;    def get_user(self):&#10;        return self.database.query()&#10;&#10;class Database:&#10;    def query(self):&#10;        return 'data'"
                  className="w-full h-64 px-3 py-2 border border-slate-300 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              
              {parseStatus && (
                <div className={`p-3 rounded-lg text-sm ${
                  parseStatus.startsWith('✓') ? 'bg-green-50 text-green-700' :
                  parseStatus.startsWith('⚠') ? 'bg-yellow-50 text-yellow-700' :
                  parseStatus.startsWith('✗') ? 'bg-red-50 text-red-700' :
                  'bg-blue-50 text-blue-700'
                }`}>
                  {parseStatus}
                </div>
              )}
            </div>
            
            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
              <button
                onClick={() => setShowImportModal(false)}
                className="px-4 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50"
              >
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

      <div className="flex-1 overflow-auto p-8 relative">
        {parseStatus && !showImportModal && (
          <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-10">
            <div className="bg-white border border-slate-200 rounded-lg shadow-lg px-4 py-2 text-sm text-slate-700">
              {parseStatus}
            </div>
          </div>
        )}
        <svg width="1400" height="800" className="bg-transparent">
          {getDisplayConnections().map((conn, i) => renderConnection(conn, i))}
          {nodes.map(node => renderNode(node))}
        </svg>
      </div>

      <div className="bg-white border-t border-slate-200 px-6 py-3 flex items-center justify-between">
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
        <div className="flex items-center gap-4">
          <button className="p-2 hover:bg-slate-100 rounded-lg" title="Zoom to fit">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" className="text-slate-600">
              <path d="M10 3a7 7 0 100 14 7 7 0 000-14zm0 2a5 5 0 110 10 5 5 0 010-10z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export default CodeWorkflowVisualizer;
