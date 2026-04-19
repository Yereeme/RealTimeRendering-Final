#version 450

layout(push_constant) uniform WaterPush {
//seconds since app start (loops in c++)
float time;
//global multiplier for wave look
float wave_strength;
//reserved for fragment foam control
float foam_strength;
//keep 16-byte layout (To make my GPU happy)
float padding;
}uWater;

layout(location = 0) out vec2 v_uv; //data passed to fragment shater per pixel
 

void main() {
//big triangle in clip space
vec2 clip_xy;
if (gl_VertexIndex == 0) clip_xy = vec2(-1.0, -1.0); 
else if (gl_VertexIndex == 1) clip_xy = vec2(3.0, -1.0);
else clip_xy = vec2(-1.0, 3.0);
//convert clip xy from [-1..1] tp uv [0..1] for fragment math
//this is "screen UV", not mesh UV.
v_uv = clip_xy * 0.5 + 0.5;

//tiny debug wobble:
// -proves push constants + time are wired
//-not real gertner displacement yet
clip_xy.y += sin((clip_xy.x + uWater.time * 0.35) * 6.28318) * 0.01 * uWater.wave_strength;

//4. final clip space position
gl_Position = vec4(clip_xy, 0.0, 1.0);
 }