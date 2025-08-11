const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// const MONGO_URL = 'mongodb+srv://backendapi:mMrsKprBMVxUdqbP@cluster0.z3vm7yg.mongodb.net/BotFlow?retryWrites=true&w=majority&appName=Cluster0';
// const MONGO_URL = 'mongodb://localhost:27017/flowsDB';
const mongoUrl = process.env.MONGO_URL;


mongoose.connect(mongoUrl)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ MongoDB connection error:", err));

const FlowSchema = new mongoose.Schema({
  name: String,
  status: Boolean,
  inbox: Boolean,
  modified: String,
});

const NodeSchema = new mongoose.Schema({
  flowId: String,
  nodeId: String,
  isStart: Boolean,
  channel: { type: String, default: 'omnichannel' },
  label: String,
  position: Object,
  type: String
});

const FlowDataSchema = new mongoose.Schema({
  flowId: String,
  flowData: {
    nodes: Array,
    edges: Array,
    nodeContents: Object
  },
  publishedData: {
    flowId: String,
    flowName: String,
    startNode: String,
    nodes: Array,
    updatedAt: String
  },
  updatedAt: String
});

const Flow = mongoose.model("Flow", FlowSchema);
const FlowNode = mongoose.model("FlowNode", NodeSchema);
const FlowData = mongoose.model("FlowData", FlowDataSchema);

app.get('/test', async (req, res) => {
  res.send({ msg: "Hello From flow Server" })
})

// Routes for basic flow info
app.get("/api/flows", async (req, res) => {
  const flows = await Flow.find();
  res.json(flows);
});

app.post("/api/flows", async (req, res) => {
  try {
    const { name } = req.body;

    // Create basic flow info
    const newFlow = new Flow({
      name: name || "New Flow",
      status: true,
      inbox: true,
      modified: new Date().toISOString().split("T")[0]
    });
    await newFlow.save();

    // Create initial node with isStart=true
    const initialNodeId = new mongoose.Types.ObjectId().toString();
    const initialNode = new FlowNode({
      flowId: newFlow._id.toString(),
      nodeId: initialNodeId,
      isStart: true,
      channel: 'omnichannel',
      label: 'Message #1',
      position: { x: 400, y: 100 },
      type: 'custom'
    });
    await initialNode.save();

    const initialNodes = [{
      id: initialNodeId,
      type: 'custom',
      position: { x: 400, y: 100 },
      data: { label: 'Message #1' }
    }];

    const initialEdges = [];

    const flowData = new FlowData({
      flowId: newFlow._id.toString(),
      flowData: {
        nodes: initialNodes,
        edges: initialEdges,
        nodeContents: {}
      },
      updatedAt: new Date().toISOString()
    });
    await flowData.save();

    res.json({
      flow: newFlow,
      flowId: newFlow._id.toString()
    });
  } catch (error) {
    console.error('Error creating new flow:', error);
    res.status(500).json({ error: 'Failed to create flow' });
  }
});

app.post("/api/flows/duplicate/:id", async (req, res) => {
  const { id } = req.params;
  const originalFlow = await Flow.findById(id);

  if (!originalFlow) {
    return res.status(404).json({ error: "Flow not found" });
  }

  const duplicatedFlow = new Flow({
    ...originalFlow.toObject(),
    _id: undefined,
    name: `Copy of ${originalFlow.name}`,
    modified: new Date().toISOString().split("T")[0]
  });

  await duplicatedFlow.save();
  res.json(duplicatedFlow);
});

app.put("/api/flows/:id", async (req, res) => {
  const { id } = req.params;
  await Flow.findByIdAndUpdate(id, req.body);
  res.sendStatus(200);
});

app.delete("/api/flows/:id", async (req, res) => {
  const { id } = req.params;
  await Flow.findByIdAndDelete(id);
  await FlowData.deleteMany({ flowId: id });
  await FlowNode.deleteMany({ flowId: id });
  res.sendStatus(200);
});

// Routes for flow data
app.get("/api/flow-data/:flowId", async (req, res) => {
  const { flowId } = req.params;
  const flowData = await FlowData.findOne({ flowId });
  res.json(flowData || { flowData: { nodes: [], edges: [] } });
});

app.post("/api/flow-data/:flowId", async (req, res) => {
  const { flowId } = req.params;
  const { flowData, publishedData } = req.body;

  await FlowData.findOneAndUpdate(
    { flowId },
    { flowData, publishedData, updatedAt: new Date().toISOString() },
    { upsert: true, new: true }
  );

  res.sendStatus(200);
});

app.post("/api/save-content/:flowId", async (req, res) => {
  const { flowId } = req.params;
  const { nodeId, content } = req.body;

  try {
    await FlowData.findOneAndUpdate(
      { flowId },
      {
        $set: {
          [`flowData.nodeContents.${nodeId}`]: content,
          updatedAt: new Date().toISOString()
        }
      },
      { upsert: true }
    );
    res.sendStatus(200);
  } catch (error) {
    console.error('Error saving content:', error);
    res.status(500).json({ error: 'Failed to save content' });
  }
});

// Node-specific routes
app.get("/api/nodes/:flowId", async (req, res) => {
  const { flowId } = req.params;
  const nodes = await FlowNode.find({ flowId });
  res.json(nodes);
});

app.post("/api/nodes/:flowId", async (req, res) => {
  const { flowId } = req.params;
  const { nodeId, channel, label, position, type } = req.body;

  const newNode = new FlowNode({
    flowId,
    nodeId,
    isStart: false, // New nodes are not start nodes by default
    channel: channel || 'omnichannel',
    label,
    position,
    type
  });

  await newNode.save();
  res.json(newNode);
});

app.put("/api/nodes/:nodeId", async (req, res) => {
  const { nodeId } = req.params;
  const { channel, isStart, label } = req.body;

  const updateData = {};
  if (channel !== undefined) updateData.channel = channel;
  if (label !== undefined) updateData.label = label;

  // Handle isStart update
  if (isStart !== undefined) {
    if (isStart) {
      // If setting this node as start, first unset any existing start node
      await FlowNode.updateMany(
        { flowId: req.body.flowId, isStart: true },
        { $set: { isStart: false } }
      );
    }
    updateData.isStart = isStart;
  }

  await FlowNode.findOneAndUpdate(
    { nodeId },
    { $set: updateData },
    { new: true }
  );

  res.sendStatus(200);
});

app.delete("/api/nodes/:nodeId", async (req, res) => {
  const { nodeId } = req.params;
  await FlowNode.deleteOne({ nodeId });
  res.sendStatus(200);
});

// Update publish endpoint to include content
app.post("/api/publish-flow/:flowId", async (req, res) => {
  const { flowId } = req.params;
  const { nodes, edges, nodeContents } = req.body;

  try {
    // Get all nodes with their channels and isStart status
    const dbNodes = await FlowNode.find({ flowId });
    const nodeMap = dbNodes.reduce((acc, node) => {
      acc[node.nodeId] = node;
      return acc;
    }, {});

    const publishedNodes = nodes.map(node => {
      const dbNode = nodeMap[node.id] || {};
      return {
        id: node.id,
        type: node.type,
        position: node.position,
        data: {
          label: node.data.label,
          content: nodeContents[node.id] || [],
          channel: dbNode.channel || 'omnichannel',
          isStart: dbNode.isStart || false
        }
      };
    });

    const startNode = dbNodes.find(node => node.isStart);

    const publishedData = {
      flowId,
      flowName: 'User Flow',
      startNode: startNode ? startNode.nodeId : null,
      nodes: publishedNodes,
      updatedAt: new Date().toISOString()
    };

    await FlowData.findOneAndUpdate(
      { flowId },
      {
        flowData: { nodes, edges, nodeContents },
        publishedData,
        updatedAt: new Date().toISOString()
      },
      { upsert: true }
    );

    res.json(publishedData);
  } catch (error) {
    console.error('Error publishing flow:', error);
    res.status(500).json({ error: 'Failed to publish flow' });
  }
});

app.listen(process.env.PORT, () => {
  console.log(`Server running at http://localhost:${process.env.PORT}`);
});