(function() {
    var data = window.graphData;
    if (!data || !data.nodes.length) {
        document.getElementById('graph-container').innerHTML = '<p style="text-align:center;opacity:0.6;">No graph data available.</p>';
        return;
    }

    var container = document.getElementById('graph-container');
    var width = container.clientWidth || 800;
    var height = container.clientHeight || 600;

    var svg = d3.select('#graph-container')
        .append('svg')
        .attr('width', width)
        .attr('height', height);

    var g = svg.append('g');

    var zoom = d3.zoom()
        .scaleExtent([0.2, 4])
        .on('zoom', function(event) {
            g.attr('transform', event.transform);
        });
    svg.call(zoom);

    var simulation = d3.forceSimulation(data.nodes)
        .force('link', d3.forceLink(data.edges).id(function(d) { return d.id; }).distance(80))
        .force('charge', d3.forceManyBody().strength(-200))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius(30));

    var link = g.append('g')
        .selectAll('line')
        .data(data.edges)
        .join('line')
        .attr('stroke', function(d) { return d.type === 'tag' ? '#51cf66' : '#4a9eff'; })
        .attr('stroke-width', function(d) { return d.type === 'link' ? 2 : 1; })
        .attr('stroke-opacity', 0.5);

    var noteNodes = g.append('g')
        .selectAll('g.note-node')
        .data(data.nodes.filter(function(d) { return d.type === 'note'; }))
        .join('g')
        .attr('class', 'note-node')
        .call(d3.drag()
            .on('start', dragstarted)
            .on('drag', dragged)
            .on('end', dragended));

    noteNodes.append('rect')
        .attr('width', function(d) { return Math.max(60, d.label.length * 6 + 16); })
        .attr('height', 24)
        .attr('rx', 6)
        .attr('ry', 6)
        .attr('x', function(d) { return -Math.max(60, d.label.length * 6 + 16) / 2; })
        .attr('y', -12)
        .attr('fill', '#4a9eff')
        .attr('opacity', 0.8)
        .style('cursor', 'pointer');

    noteNodes.append('text')
        .text(function(d) { return d.label; })
        .attr('text-anchor', 'middle')
        .attr('dy', '0.35em')
        .attr('fill', 'white')
        .attr('font-size', '10px')
        .style('pointer-events', 'none');

    var tagNodes = g.append('g')
        .selectAll('g.tag-node')
        .data(data.nodes.filter(function(d) { return d.type === 'tag'; }))
        .join('g')
        .attr('class', 'tag-node')
        .call(d3.drag()
            .on('start', dragstarted)
            .on('drag', dragged)
            .on('end', dragended));

    tagNodes.append('rect')
        .attr('width', function(d) { return d.label.length * 7 + 14; })
        .attr('height', 18)
        .attr('rx', 9)
        .attr('ry', 9)
        .attr('x', function(d) { return -(d.label.length * 7 + 14) / 2; })
        .attr('y', -9)
        .attr('fill', '#51cf66')
        .attr('opacity', 0.7);

    tagNodes.append('text')
        .text(function(d) { return d.label; })
        .attr('text-anchor', 'middle')
        .attr('dy', '0.35em')
        .attr('fill', 'white')
        .attr('font-size', '9px')
        .style('pointer-events', 'none');

    var tooltip = d3.select('body').append('div')
        .style('position', 'absolute')
        .style('padding', '6px 10px')
        .style('background', 'rgba(0,0,0,0.8)')
        .style('color', 'white')
        .style('border-radius', '4px')
        .style('font-size', '12px')
        .style('pointer-events', 'none')
        .style('opacity', 0);

    noteNodes.on('mouseenter', function(event, d) {
        tooltip.text(d.summary || d.label).style('opacity', 1);
    }).on('mousemove', function(event) {
        tooltip.style('left', (event.pageX + 10) + 'px').style('top', (event.pageY - 20) + 'px');
    }).on('mouseleave', function() {
        tooltip.style('opacity', 0);
    });

    noteNodes.on('click', function(event, d) {
        if (window.vscodeApi) {
            window.vscodeApi.postMessage({ command: 'openNote', path: d.id });
        } else if (window.graphNavBase) {
            window.location.href = window.graphNavBase + encodeURIComponent(d.label.replace('.md', '.html'));
        }
    });

    simulation.on('tick', function() {
        link
            .attr('x1', function(d) { return d.source.x; })
            .attr('y1', function(d) { return d.source.y; })
            .attr('x2', function(d) { return d.target.x; })
            .attr('y2', function(d) { return d.target.y; });

        noteNodes.attr('transform', function(d) { return 'translate(' + d.x + ',' + d.y + ')'; });
        tagNodes.attr('transform', function(d) { return 'translate(' + d.x + ',' + d.y + ')'; });
    });

    function dragstarted(event, d) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
    }

    function dragged(event, d) {
        d.fx = event.x;
        d.fy = event.y;
    }

    function dragended(event, d) {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
    }
})();
