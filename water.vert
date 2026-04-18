#version 450

 

void main() {
//full-screen triangle
//avoids needing a mesh for first pipeline proof
vec2 p;
if (gl_VertexIndex == 0) p = vec2(-1.0, -1.0);
else if (gl_VertexIndex == 1) p = vec2(3.0, -1.0);
else p = vec2(-1.0, 3.0);

gl_Position = vec4(p, 0.0, 1.0);
 }